// cmc-push.mjs
// WaterVoice DMV — fetch CMC from a residential IP and POST to the ingest-cmc
// edge function. Replaces the manual SQL-paste step (cmc-to-sql.mjs).
//
// FLOW:
//   This machine (residential IP) --fetch--> CMC Data Explorer
//   This machine --POST samples--> ingest-cmc edge function (x-cron-secret auth)
//   ingest-cmc (service-role) --upsert--> readings
//
// WHY LOCAL: CMC resets connections from cloud datacenter IPs. The fetch must
// run from a non-datacenter IP. The edge function does the DB writes.
//
// REQUIREMENTS: Node.js 22+ (built-in fetch + --env-file). No npm install.
//
// RUN (from cmc_to_sql/ directory):
//   node --env-file=.env cmc-push.mjs
//
// SCHEDULE (Windows Task Scheduler):
//   Program:        node
//   Arguments:      --env-file=.env cmc-push.mjs
//   Start in:       C:\path\to\dc-water-watch\cmc_to_sql
//
// PORTABILITY: when CMC fetch moves to a Pi/EC2/allowlisted host later, only
// INGEST_URL changes (update .env on the new host). The payload contract stays
// identical.

// ── Environment (copy cmc_to_sql/.env.example → .env and fill in values) ───
const INGEST_URL = process.env.INGEST_URL;
const CRON_SECRET = process.env.CRON_SECRET;

const _missing = [];
if (!INGEST_URL) _missing.push("INGEST_URL");
if (!CRON_SECRET) _missing.push("CRON_SECRET");
if (_missing.length > 0) {
  console.error(
    `[cmc-push] Missing required environment variable(s): ${_missing.join(", ")}\n` +
      `  Copy cmc_to_sql/.env.example to cmc_to_sql/.env, fill in the real values,\n` +
      `  then run:  node --env-file=.env cmc-push.mjs`,
  );
  process.exit(1);
}

// ── CMC fetch config ────────────────────────────────────────────────────────
const CMC_URL = "https://cmc2.vims.edu/DashboardApi/FetchSamplesForDownload";
// Full-bay fetch: empty watersheds + empty parameters returns ALL data across
// VA/MD/DC/WV/DE (confirmed 2026-07-05: states:'' watersheds:'' -> full dataset;
// the ?variant=va/cmc/wv URLs are UI presets over this same backend, not
// separate endpoints). We filter to bacteria indicators client-side by
// ParameterCode prefix rather than by numeric IDs, so we never miss a variant.
// NOTE: do NOT pass a states value like "VA" — the API returns an empty body
// (JSON parse error) for state-string filters. Leave states empty.
const WATERSHEDS = process.env.CMC_WATERSHEDS ?? ""; // "" = all bay
const PARAMETERS = process.env.CMC_PARAMETERS ?? ""; // "" = all; filtered below

// Bacteria indicators we STORE (each maps to a typed column + its own EPA
// threshold). Fecal coliform (FC.*) is intentionally excluded: no dedicated
// column and distinct thresholds (200 CFU/100mL geomean) — mis-storing it in a
// safety app would produce wrong classifications.
const STORE_PREFIXES = ["ECOLI", "ENT"];

// Override for one-time historical backfill, e.g.:
//   node --env-file=.env cmc-push.mjs            (daily: 90d)
//   CMC_LOOKBACK_DAYS=3000 node --env-file=.env cmc-push.mjs   (backfill to 2018)
const LOOKBACK_DAYS = Number(process.env.CMC_LOOKBACK_DAYS ?? "90");

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

function parseSampledAt(row) {
  const dt = String(row["DateTime"] ?? "").trim();
  if (dt && dt !== "null") return dt.replace(" ", "T") + "Z";
  const d = String(row["Date"] ?? "").trim();
  if (d && d !== "null") return `${d}T00:00:00.000Z`;
  return new Date().toISOString();
}

async function fetchCMC() {
  const end = new Date();
  const start = new Date(end.getTime() - LOOKBACK_DAYS * 86_400_000);
  const payload = {
    dataType: "Water Quality",
    groups: "",
    stations: "",
    states: "",
    counties: "",
    watersheds: WATERSHEDS,
    subwatersheds: "",
    startDate: fmtDate(start),
    endDate: fmtDate(end),
    parameters: PARAMETERS,
  };

  console.log(`[CMC] Fetching ${LOOKBACK_DAYS}d: ${payload.startDate} -> ${payload.endDate}`);
  const res = await fetch(CMC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
      Origin: "https://cmc.vims.edu",
      Referer: "https://cmc.vims.edu/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`CMC HTTP ${res.status} ${res.statusText}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error("CMC response not an array");
  console.log(`[CMC] Raw rows: ${rows.length}`);
  return rows;
}

function indicatorFor(parameterCode) {
  const pc = String(parameterCode ?? "")
    .trim()
    .toUpperCase();
  for (const pfx of STORE_PREFIXES) {
    if (pc.startsWith(pfx)) return pfx === "ECOLI" ? "ecoli" : "enterococci";
  }
  return null;
}

function buildSamples(rows) {
  const samples = [];
  let skipParam = 0,
    skipProblem = 0,
    skipValue = 0;
  const byIndicator = { ecoli: 0, enterococci: 0 };
  for (const raw of rows) {
    const indicator = indicatorFor(raw["ParameterCode"]);
    if (!indicator) {
      skipParam++;
      continue;
    }
    if (String(raw["ProblemCode"] ?? "").trim() !== "") {
      skipProblem++;
      continue;
    }
    const vr = raw["Value"];
    const value = typeof vr === "number" ? vr : parseFloat(String(vr ?? ""));
    if (!Number.isFinite(value) || value < 0) {
      skipValue++;
      continue;
    }
    const stationCode = String(raw["StationCode"] ?? "").trim();
    if (!stationCode) {
      skipValue++;
      continue;
    }

    // API returns "Lat"/"Long" (NOT Latitude/Longitude). Extract explicitly so
    // the receiver's coordinate-match (stage 3) and station-creation (stage 4)
    // stages have coordinates to work with.
    const lat = Number(raw["Lat"]);
    const lng = Number(raw["Long"]);

    // Send both a generic `value` + `indicator`, and keep `ecoliMpn` populated
    // only for E. coli so an older ingest-cmc still ingests E. coli unchanged
    // (backward-compatible: old function reads ecoliMpn, new one reads
    // value+indicator).
    samples.push({
      stationCode,
      sampledAt: parseSampledAt(raw),
      indicator, // "ecoli" | "enterococci"
      value,
      ecoliMpn: indicator === "ecoli" ? value : undefined,
      groupCode: String(raw["GroupCode"] ?? "").trim(),
      parameterCode: String(raw["ParameterCode"] ?? ""),
      sampleId: String(raw["SampleId"] ?? ""),
      latitude: Number.isFinite(lat) ? lat : undefined,
      longitude: Number.isFinite(lng) ? lng : undefined,
      rawRow: raw,
    });
    byIndicator[indicator]++;
  }
  console.log(
    `[CMC] Valid: ${samples.length} (ecoli=${byIndicator.ecoli} enterococci=${byIndicator.enterococci}) | ` +
      `skipped param=${skipParam} problem=${skipProblem} value=${skipValue}`,
  );
  return samples;
}

// Default 500 for the full-bay volume (~4.7k rows/90d): keeps each edge-function
// invocation's matching/creation/assignment work under the wall-clock ceiling.
const PUSH_BATCH = Number(process.env.CMC_PUSH_BATCH ?? "500");

async function pushToIngest(samples) {
  // Chunked: a historical backfill can be 20k+ samples; one giant POST risks
  // request-size limits and edge-function timeouts. Each batch is independent
  // and idempotent (server dedups on site_id,sampled_at,data_source).
  const totals = {};
  const batches = [];
  for (let i = 0; i < samples.length; i += PUSH_BATCH) {
    batches.push(samples.slice(i, i + PUSH_BATCH));
  }
  console.log(
    `[push] POSTing ${samples.length} samples to ingest-cmc in ${batches.length} batch(es) of <=${PUSH_BATCH}...`,
  );
  for (let b = 0; b < batches.length; b++) {
    const res = await fetch(INGEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET },
      body: JSON.stringify({ samples: batches[b] }),
    });
    const text = await res.text();
    if (!res.ok)
      throw new Error(`ingest-cmc batch ${b + 1}/${batches.length} HTTP ${res.status}: ${text}`);
    let summary;
    try {
      summary = JSON.parse(text);
    } catch {
      summary = text;
    }
    console.log(`[push] batch ${b + 1}/${batches.length}:`, JSON.stringify(summary));
    if (summary && typeof summary === "object") {
      for (const [k, v] of Object.entries(summary)) {
        if (typeof v === "number") totals[k] = (totals[k] ?? 0) + v;
        else if (Array.isArray(v)) totals[k] = [...(totals[k] ?? []), ...v];
      }
    }
  }
  return totals;
}

async function main() {
  const rows = await fetchCMC();
  const samples = buildSamples(rows);
  if (samples.length === 0) {
    console.log("[push] Nothing to send.");
    return;
  }
  const summary = await pushToIngest(samples);
  console.log("[push] ingest-cmc summary:");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error("[cmc-push] FAILED:", e);
  process.exit(1);
});
