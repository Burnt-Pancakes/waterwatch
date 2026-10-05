// cmc-to-sql.mjs
// WaterVoice DMV — CMC ingestion via generated SQL (no service-role key needed).
//
// WHY THIS EXISTS:
//   CMC's server (Microsoft-IIS on vims.edu campus infrastructure) resets TCP
//   connections from cloud datacenter IPs — so the Supabase edge function gets
//   "Connection reset by peer (os error 104)" and cannot reach CMC. A residential
//   IP works fine. This script runs on YOUR machine, fetches CMC from your IP,
//   and emits a .sql file you paste into the Supabase SQL editor. The station→site
//   matching + dedup happen server-side in that SQL against your live tables.
//
// REQUIREMENTS: Node.js 18+ (uses built-in global fetch). No npm install needed.
//
// RUN:
//   node cmc-to-sql.mjs
//   -> writes cmc-ingest-YYYY-MM-DD.sql in the same folder
//   -> open that file, copy all, paste into Supabase SQL editor, Run.
//
// SCHEDULE (optional, Windows Task Scheduler):
//   Program:   node
//   Arguments: C:\path\to\cmc-to-sql.mjs
//   (then paste the generated .sql periodically — CMC data is low-frequency)

import { writeFileSync } from "node:fs";

// ── Config (mirrors cmc-adapter.ts) ─────────────────────────────────────────
const CMC_URL = "https://cmc2.vims.edu/DashboardApi/FetchSamplesForDownload";
const ECOLI_PARAMS = "319, 229, 476, 501, 422, 430, 516";
const DMV_WATERSHEDS = "Potomac,Upper Chesapeake,Lower Chesapeake,James";
const LOOKBACK_DAYS = 90;
const MAX_MATCH_DISTANCE_M = 25000;
const CMC_WQP_PREFIX = "CHESAPEAKEMONITORINGCOOP-CMC.";

const EPA_GM_THRESHOLD = 235; // caution
const EPA_STV_THRESHOLD = 410; // unsafe

const GROUP_DISPLAY = {
  ARK: "Anacostia Riverkeeper",
  PRK: "Potomac Riverkeeper",
  ACB: "Anacostia Community Boathouse",
  FMR: "Friends of the Rappahannock",
  SHR: "Shenandoah Riverkeeper",
  TWC: "Two Creeks",
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function classifyStatus(mpn) {
  if (mpn >= EPA_STV_THRESHOLD) return "unsafe";
  if (mpn >= EPA_GM_THRESHOLD) return "caution";
  return "pass";
}

function groupToDataSource(groupCode) {
  return GROUP_DISPLAY[groupCode] ?? `CMC / ${groupCode}`;
}

function parseSampledAt(row) {
  const dt = String(row["DateTime"] ?? "").trim();
  if (dt && dt !== "null") return dt.replace(" ", "T") + "Z";
  const d = String(row["Date"] ?? "").trim();
  if (d && d !== "null") return `${d}T00:00:00.000Z`;
  return new Date().toISOString();
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

// SQL-escape a string literal (double any single quotes).
function sq(v) {
  if (v === null || v === undefined) return "NULL";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

// SQL number or NULL.
function num(v) {
  return Number.isFinite(v) ? String(v) : "NULL";
}

// jsonb literal: stringify, escape quotes, cast.
function jsonb(obj) {
  const s = JSON.stringify(obj).replace(/'/g, "''");
  return "'" + s + "'::jsonb";
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const end = new Date();
  const start = new Date(end.getTime() - LOOKBACK_DAYS * 86_400_000);

  const payload = {
    dataType: "Water Quality",
    groups: "",
    stations: "",
    states: "",
    counties: "",
    watersheds: DMV_WATERSHEDS,
    subwatersheds: "",
    startDate: fmtDate(start),
    endDate: fmtDate(end),
    parameters: ECOLI_PARAMS,
  };

  console.log(
    `[CMC] Fetching ${LOOKBACK_DAYS}d window: ${payload.startDate} -> ${payload.endDate}`,
  );

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

  if (!res.ok) {
    console.error(`[CMC] HTTP ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const rows = await res.json();
  if (!Array.isArray(rows)) {
    console.error("[CMC] Unexpected response (not an array).");
    process.exit(1);
  }
  console.log(`[CMC] Raw rows: ${rows.length}`);

  // Build staging rows
  const staging = [];
  let skipProblem = 0,
    skipValue = 0,
    skipParam = 0;

  for (const raw of rows) {
    const paramCode = String(raw["ParameterCode"] ?? "")
      .trim()
      .toUpperCase();
    if (!paramCode.startsWith("ECOLI")) {
      skipParam++;
      continue;
    }

    const problemCode = String(raw["ProblemCode"] ?? "").trim();
    if (problemCode !== "") {
      skipProblem++;
      continue;
    }

    const valueRaw = raw["Value"];
    const mpn = typeof valueRaw === "number" ? valueRaw : parseFloat(String(valueRaw ?? ""));
    if (!Number.isFinite(mpn) || mpn < 0) {
      skipValue++;
      continue;
    }

    const cmcCode = String(raw["StationCode"] ?? "").trim();
    if (!cmcCode) {
      skipValue++;
      continue;
    }

    const groupCode = String(raw["GroupCode"] ?? "").trim();
    staging.push({
      cmcCode,
      sampledAt: parseSampledAt(raw),
      mpn,
      status: classifyStatus(mpn),
      dataSource: groupToDataSource(groupCode),
      parameterCode: String(raw["ParameterCode"] ?? ""),
      sampleId: String(raw["SampleId"] ?? ""),
      groupCode,
      raw,
    });
  }

  console.log(
    `[CMC] Valid: ${staging.length} | skipped problem=${skipProblem} value=${skipValue} param=${skipParam}`,
  );

  if (staging.length === 0) {
    console.log("[CMC] Nothing to write. Exiting.");
    return;
  }

  // Build SQL
  const valuesRows = staging.map((s) => {
    const notes = `CMC ${s.groupCode} / ${s.cmcCode} / ${s.parameterCode} / sampleId ${s.sampleId}`;
    return `(${sq(s.cmcCode)}, ${sq(s.sampledAt)}::timestamptz, ${num(s.mpn)}, ${sq(s.status)}, ${sq(s.dataSource)}, 'lab', ${sq(s.parameterCode)}, ${sq(s.sampleId)}, ${jsonb(s.raw)}, ${sq(notes)})`;
  });

  const sql = `-- ════════════════════════════════════════════════════════════════════════════
-- WaterVoice DMV — CMC ingestion
-- Generated ${new Date().toISOString()}  |  ${staging.length} samples
-- Paste this whole script into the Supabase SQL editor and Run.
-- Station matching + dedup happen server-side against live tables.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE cmc_staging (
  cmc_code        text,
  sampled_at      timestamptz,
  e_coli_mpn      double precision,
  status          text,
  data_source     text,
  sample_method   text,
  parameter_code  text,
  sample_id       text,
  raw_payload     jsonb,
  notes           text
) ON COMMIT DROP;

INSERT INTO cmc_staging
  (cmc_code, sampled_at, e_coli_mpn, status, data_source, sample_method, parameter_code, sample_id, raw_payload, notes)
VALUES
${valuesRows.join(",\n")};

-- Insert into readings: join staging -> monitoring_stations (by WQP-prefixed code)
-- -> site_station_assignments (within match radius). DISTINCT ON collapses
-- multiple parameter rows at the same (site, time, source) to the highest reading
-- (most conservative for a safety advisory). ON CONFLICT skips existing rows.
INSERT INTO readings
  (site_id, monitoring_station_id, sampled_at, e_coli_mpn, enterococci_cce,
   sample_method, data_source, source_url, status, raw_payload, notes)
SELECT DISTINCT ON (ssa.site_id, st.sampled_at, st.data_source)
  ssa.site_id,
  ms.id,
  st.sampled_at,
  st.e_coli_mpn,
  NULL::double precision,
  st.sample_method,
  st.data_source,
  'https://cmc.vims.edu/data-explorer',
  st.status,
  st.raw_payload,
  st.notes
FROM cmc_staging st
JOIN monitoring_stations ms
  ON ms.station_code = '${CMC_WQP_PREFIX}' || st.cmc_code
JOIN site_station_assignments ssa
  ON ssa.station_id = ms.id
 AND ssa.distance_m <= ${MAX_MATCH_DISTANCE_M}
ORDER BY ssa.site_id, st.sampled_at, st.data_source, st.e_coli_mpn DESC
ON CONFLICT (site_id, sampled_at, data_source) DO NOTHING;

-- Refresh last_sample_at for touched CMC stations (freshness indicator on markers).
UPDATE monitoring_stations ms
SET last_sample_at = sub.max_ts
FROM (
  SELECT ms2.id AS id, MAX(st.sampled_at) AS max_ts
  FROM cmc_staging st
  JOIN monitoring_stations ms2
    ON ms2.station_code = '${CMC_WQP_PREFIX}' || st.cmc_code
  GROUP BY ms2.id
) sub
WHERE ms.id = sub.id
  AND (ms.last_sample_at IS NULL OR sub.max_ts > ms.last_sample_at);

COMMIT;

-- ── Verification ────────────────────────────────────────────────────────────
-- 1. Counts by data_source (CMC group names should now appear)
SELECT data_source, COUNT(*) AS readings, COUNT(DISTINCT site_id) AS sites,
       MIN(sampled_at)::date AS earliest, MAX(sampled_at)::date AS latest
FROM readings
WHERE source_url = 'https://cmc.vims.edu/data-explorer'
GROUP BY data_source
ORDER BY readings DESC;

-- 2. Status spread (must be lowercase pass/caution/unsafe)
SELECT status, COUNT(*) FROM readings
WHERE source_url = 'https://cmc.vims.edu/data-explorer'
GROUP BY status ORDER BY 2 DESC;
`;

  const outName = `cmc-ingest-${fmtDate(end)}.sql`;
  writeFileSync(outName, sql, "utf8");
  console.log(`[CMC] Wrote ${outName} (${valuesRows.length} VALUES rows)`);
  console.log(`[CMC] Next: open ${outName}, copy all, paste into Supabase SQL editor, Run.`);
}

main().catch((e) => {
  console.error("[CMC] FAILED:", e);
  process.exit(1);
});
