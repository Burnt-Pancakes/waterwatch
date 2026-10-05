// supabase/functions/fetch-water-quality/index.ts
//
// WaterVoice DMV — daily water quality ingestion
// Sources:
//   1. EPA Water Quality Portal (WQP) — bbox-tiled E. coli + Enterococci
//   2. CMC Data Explorer — direct community-science E. coli (cmc-adapter.ts)
// Maps readings to paddle sites via site_station_assignments, classifies
// Pass/Caution/Unsafe against EPA recreational thresholds, inserts into readings.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchFromCMC, classifyStatus as classifyCMC } from "./cmc-adapter.ts";

const WQP_RESULT_URL = "https://www.waterqualitydata.us/wqx3/Result/search";
const USER_AGENT = "WaterVoiceDMV/1.0 rajivsundar@gmail.com";
const LOOKBACK_DAYS = 90;
const MAX_MATCH_DISTANCE_M = 25000;

// CMC stations are stored in monitoring_stations with this WQP org prefix.
const CMC_WQP_PREFIX = "CHESAPEAKEMONITORINGCOOP-CMC.";

// Contiguous tiled grid over the full DMV extent covering all 792 paddle sites
// (site coords span lng -79.5..-75.4, lat 36.5..39.7; measured 2026-07-08). The
// previous 5 hand-drawn boxes had SEAMS (uncovered gaps between them) and omitted
// central/northern MD entirely (52 sites) — that omission is why Maryland MDE
// showed zero readings. A contiguous grid removes both problems.
//
// TILE_DEG controls tile size. Smaller tiles = more requests but each is lighter
// on WQP (which returns intermittent 500s on load). 0.5° over this extent is
// ~16 x 7 ≈ 112 tiles. Tunable via env without a code change.
const GRID = {
  west: Number(Deno.env.get("WQP_WEST") ?? "-83.4"), // include far SW VA stations
  south: Number(Deno.env.get("WQP_SOUTH") ?? "36.4"),
  east: Number(Deno.env.get("WQP_EAST") ?? "-75.0"), // include Ocean City / Assateague coast
  north: Number(Deno.env.get("WQP_NORTH") ?? "39.8"),
  tileDeg: Number(Deno.env.get("WQP_TILE_DEG") ?? "0.5"),
};

interface Tile {
  name: string;
  bbox: string;
  w: number;
  s: number;
  e: number;
  n: number;
}

function buildBBoxes(): Tile[] {
  const out: Tile[] = [];
  const { west, south, east, north, tileDeg } = GRID;
  let row = 0;
  for (let s = south; s < north; s += tileDeg, row++) {
    let col = 0;
    for (let w = west; w < east; w += tileDeg, col++) {
      const e = Math.min(w + tileDeg, east);
      const n = Math.min(s + tileDeg, north);
      // WQP bBox order: west,south,east,north
      out.push({
        name: `r${row}c${col}`,
        bbox: `${w.toFixed(3)},${s.toFixed(3)},${e.toFixed(3)},${n.toFixed(3)}`,
        w,
        s,
        e,
        n,
      });
    }
  }
  return out;
}

// Keep only tiles that contain at least one active site (expanded by a margin so
// a station just outside a site's tile but within assignment range is still
// fetched). Most full-grid tiles are open ocean / empty land with no paddle
// sites — querying them wastes the wall clock. Filtering to site-bearing tiles
// cuts ~119 tiles to a few dozen without losing any site coverage.
function tilesNearSites(
  all: Tile[],
  sites: Array<{ lat: number; lng: number }>,
  marginDeg = 0.25,
): Tile[] {
  return all.filter((t) =>
    sites.some(
      (p) =>
        p.lng >= t.w - marginDeg &&
        p.lng <= t.e + marginDeg &&
        p.lat >= t.s - marginDeg &&
        p.lat <= t.n + marginDeg,
    ),
  );
}

const BBOXES = buildBBoxes();

// Retry + pacing: WQP throws transient 500s under load. The old code had NO
// retry, so any 500 silently dropped that whole region for the day. Retry with
// backoff, and pause between tiles so we don't self-induce overload.
const WQP_RETRIES = Number(Deno.env.get("WQP_RETRIES") ?? "3");
// Pace between tiles. Retries already absorb transient 500s, so this can be
// modest. ~83 site-bearing tiles x (0.3s pause + fetch) keeps a typical run
// under the edge-function wall clock. If runs time out, raise WQP_TILE_DEG
// (fewer, larger tiles) rather than lowering this further — larger tiles mean
// fewer requests. Conversely if WQP 500s spike, raise the pause.
const WQP_TILE_PAUSE_MS = Number(Deno.env.get("WQP_TILE_PAUSE_MS") ?? "300");
// Concurrent WQP requests in flight at once. 5 is what the diagnostic probe
// proved safe (2026-09-11: no 429s, no Retry-After, no observed per-client
// throttle at 5 concurrent) - do not raise this default without re-running
// that probe. Bounded by a worker pool, not fixed batches: per-tile latency
// varies 1.2s-14.3s (same probe), so a fixed batch pays for its slowest
// member every wave; a pool keeps all N lanes continuously busy instead.
const WQP_TILE_CONCURRENCY = Number(Deno.env.get("WQP_TILE_CONCURRENCY") ?? "5");
const WQP_ASSIGN_RADIUS_M = Number(Deno.env.get("WQP_ASSIGN_RADIUS_M") ?? "1500");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Diagnostic: cap the number of grid tiles for a per-tile timing run (?tiles=N).
let diagMaxTiles = 0;

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const p = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * p) / 2) ** 2 +
    Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(((lon2 - lon1) * p) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const THRESHOLDS = {
  freshwater_ecoli: { caution: 235, unsafe: 410 },
  tidal_enterococci: { caution: 70, unsafe: 104 },
};

function classify(isTidal: boolean, ecoli: number | null, entero: number | null): string {
  if (isTidal) {
    if (entero == null) return ecoliFallback(ecoli);
    if (entero >= THRESHOLDS.tidal_enterococci.unsafe) return "unsafe";
    if (entero >= THRESHOLDS.tidal_enterococci.caution) return "caution";
    return "pass";
  } else {
    if (ecoli == null) return enteroFallback(entero);
    if (ecoli >= THRESHOLDS.freshwater_ecoli.unsafe) return "unsafe";
    if (ecoli >= THRESHOLDS.freshwater_ecoli.caution) return "caution";
    return "pass";
  }
}

function ecoliFallback(ecoli: number | null): string {
  if (ecoli == null) return "pass";
  if (ecoli >= THRESHOLDS.freshwater_ecoli.unsafe) return "unsafe";
  if (ecoli >= THRESHOLDS.freshwater_ecoli.caution) return "caution";
  return "pass";
}
function enteroFallback(entero: number | null): string {
  if (entero == null) return "pass";
  if (entero >= THRESHOLDS.tidal_enterococci.unsafe) return "unsafe";
  if (entero >= THRESHOLDS.tidal_enterococci.caution) return "caution";
  return "pass";
}

function dateLo(): string {
  const d = new Date();
  d.setDate(d.getDate() - LOOKBACK_DAYS);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${d.getFullYear()}`;
}

function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [],
    field = "",
    inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') inQ = false;
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") {
        cur.push(field);
        field = "";
      } else if (c === "\n") {
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = "";
      } else if (c === "\r") {
        /* skip */
      } else field += c;
    }
  }
  if (field.length || cur.length) {
    cur.push(field);
    rows.push(cur);
  }
  if (rows.length < 2) return [];
  const header = rows[0];
  return rows
    .slice(1)
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function extractReading(row: Record<string, string>) {
  const char = (row["Result_Characteristic"] || row["CharacteristicName"] || "").toLowerCase();
  const valRaw = row["Result_Measure"] || row["ResultMeasureValue"] || "";
  const val = parseFloat(valRaw);
  const stationCode = row["Location_Identifier"] || row["MonitoringLocationIdentifier"] || "";
  const date = row["Activity_StartDate"] || row["ActivityStartDate"] || "";
  const time = row["Activity_StartTime"] || row["ActivityStartTime"] || "00:00:00";
  if (!stationCode || !date || isNaN(val)) return null;
  const isEcoli =
    char.includes("escherichia") || char.includes("e. coli") || char.includes("e.coli");
  const isEntero = char.includes("enterococc");
  if (!isEcoli && !isEntero) return null;

  // Station metadata is present on every Result row (WQX3 Result profile), so we
  // can create missing stations without a separate Station-endpoint call.
  const lat = parseFloat(row["Location_LatitudeStandardized"] || row["Location_Latitude"] || "");
  const lng = parseFloat(row["Location_LongitudeStandardized"] || row["Location_Longitude"] || "");
  const locType = (row["Location_Type"] || "").trim();
  const isTidal = /estuary|tidal|coastal|ocean|bay/i.test(locType);

  return {
    stationCode,
    sampledAt: new Date(`${date}T${time}Z`).toISOString(),
    ecoli: isEcoli ? val : null,
    entero: isEntero ? val : null,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    orgId: row["Org_Identifier"] || "",
    locName: row["Location_Name"] || stationCode,
    locType: locType || "Stream",
    huc8: row["Location_HUCEightDigitCode"] || null,
    stateCode: row["Location_StatePostalCode"] || null,
    isTidal,
    raw: row,
  };
}

// WQP org identifier -> agency code used by friendlySource(). WQX3 rows carry
// Org_Identifier like "USGS", "21VASWCB" (VA DEQ), "MDE_EASP", "11NPSWRD".
function agencyFromOrg(orgId: string): string {
  const o = (orgId || "").toUpperCase();
  if (o.includes("USGS")) return "USGS";
  if (o.startsWith("21VA") || o.includes("VADEQ") || o.includes("VASWCB")) return "VADEQ";
  if (o.includes("MDE")) return "MDE";
  if (o.includes("DOEE") || o.includes("21DC")) return "DOEE";
  if (o.includes("NPS")) return "NPS";
  if (o.includes("WVDEP") || o.startsWith("WVDEP")) return "WVDEP";
  if (o.includes("TDEC") || o.includes("TN")) return "TDEC";
  if (o.includes("NARS") || o.includes("EPA")) return "EPA-NARS";
  return orgId || "WQP";
}

// Per-invocation timing counters for the WQP grid phase. These are SUMS of
// per-tile durations, not wall clock - with tiles now running concurrently
// (WQP_TILE_CONCURRENCY lanes), http_ms/tile_pause_ms/parse_ms can add up to
// several times timing_ms.wqp_grid_ms (the actual elapsed time of the grid
// phase). Compare against wqp_grid_ms for real elapsed time, not against these.
const wqpTiming = {
  http_ms: 0,
  parse_ms: 0,
  retry_backoff_ms: 0,
  tile_pause_ms: 0,
  attempts: 0,
  retries: 0,
  bytes: 0,
};

// Fetch one WQP tile with retry+backoff on transient 5xx/network errors.
// Returns per-call timing so the grid loop can compute an unaccounted bucket.
async function fetchTile(
  url: string,
): Promise<{ ok: boolean; csv?: string; error?: string; httpMs: number; backoffMs: number }> {
  let lastErr = "";
  let httpMs = 0;
  let backoffMs = 0;
  for (let attempt = 1; attempt <= WQP_RETRIES; attempt++) {
    wqpTiming.attempts++;
    if (attempt > 1) wqpTiming.retries++;
    const t0 = Date.now();
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 90000);
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/csv" },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (res.ok) {
        const csv = await res.text();
        const d = Date.now() - t0;
        httpMs += d;
        wqpTiming.http_ms += d;
        wqpTiming.bytes += csv.length;
        return { ok: true, csv, httpMs, backoffMs };
      }
      const d = Date.now() - t0;
      httpMs += d;
      wqpTiming.http_ms += d;
      lastErr = `HTTP ${res.status}`;
      // 5xx is transient (WQP overload); 4xx is not worth retrying.
      if (res.status < 500) return { ok: false, error: lastErr, httpMs, backoffMs };
    } catch (e) {
      const d = Date.now() - t0;
      httpMs += d;
      wqpTiming.http_ms += d;
      lastErr = String(e);
    }
    if (attempt < WQP_RETRIES) {
      const s0 = Date.now();
      await sleep(1000 * attempt); // linear backoff
      const d = Date.now() - s0;
      backoffMs += d;
      wqpTiming.retry_backoff_ms += d;
    }
  }
  return { ok: false, error: lastErr, httpMs, backoffMs };
}

function friendlySource(agency: string): string {
  const map: Record<string, string> = {
    DOEE: "DC DOEE",
    MDE: "Maryland MDE",
    VADEQ: "Virginia DEQ",
    CMC: "Chesapeake Monitoring Coop",
    USGS: "USGS",
    NPS: "National Park Service",
    "EPA-NARS": "EPA NARS",
    WVDEP: "WV DEP",
    TDEC: "Tennessee DEC",
    NJDEP: "NJ DEP",
  };
  return map[agency] || agency;
}

Deno.serve(async (req) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET");
  const authHeader = req.headers.get("Authorization");
  const xCronSecret = req.headers.get("x-cron-secret");
  const isAuthorized =
    authHeader === `Bearer ${serviceKey}` ||
    (cronSecret !== undefined && xCronSecret === cronSecret);
  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Diagnostic probe: 5 concurrent tile requests, no retries, no DB writes.
  // Answers whether WQP latency is per-request or a per-client throttle.
  const probeParams = new URL(req.url).searchParams;
  diagMaxTiles = Number(probeParams.get("tiles") ?? "0") || 0;
  if (probeParams.get("probe") === "1") {
    const lo = dateLo();
    const tiles = BBOXES.slice(0, 5);
    const useUa = probeParams.get("ua") === "1";
    const seq = probeParams.get("mode") === "seq";
    const t0 = Date.now();
    const hit = async ({ name, bbox }: { name: string; bbox: string }) => {
      const startedOffsetMs = Date.now() - t0;
      const url =
        `${WQP_RESULT_URL}?bBox=${encodeURIComponent(bbox)}` +
        `&characteristicName=${encodeURIComponent("Escherichia coli")}` +
        `&characteristicName=${encodeURIComponent("Enterococci")}` +
        `&startDateLo=${lo}&mimeType=csv` +
        `&dataProfile=basicPhysChem` +
        `&providers=NWIS&providers=STORET`;
      const headers: Record<string, string> = { Accept: "text/csv" };
      if (useUa) headers["User-Agent"] = USER_AGENT;
      const s = Date.now();
      try {
        const res = await fetch(url, { headers });
        const ttfbMs = Date.now() - s;
        const body = await res.text();
        const out = {
          tile: name,
          started_offset_ms: startedOffsetMs,
          status: res.status,
          ttfb_ms: ttfbMs,
          total_ms: Date.now() - s,
          finished_at_ms: Date.now() - t0,
          bytes: body.length,
          retry_after: res.headers.get("retry-after"),
        };
        console.log(`[probe] ${JSON.stringify(out)}`);
        return out;
      } catch (e) {
        const out = {
          tile: name,
          started_offset_ms: startedOffsetMs,
          status: "NETWORK_ERROR",
          error: String(e),
          total_ms: Date.now() - s,
          finished_at_ms: Date.now() - t0,
        };
        console.log(`[probe] ${JSON.stringify(out)}`);
        return out;
      }
    };
    let results: any[] = [];
    if (seq) {
      for (const t of tiles) results.push(await hit(t));
    } else {
      results = await Promise.all(tiles.map(hit));
    }
    return new Response(
      JSON.stringify(
        {
          mode: seq ? "sequential" : "concurrent",
          user_agent: useUa,
          wall_clock_ms: Date.now() - t0,
          results,
        },
        null,
        2,
      ),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // The full grid run can exceed the gateway's 150s idle limit, so keep it
  // alive as a background task and return whatever is ready within 120s.
  const work = runIngest(supabase);
  try {
    (globalThis as any).EdgeRuntime?.waitUntil?.(work);
  } catch {
    /* waitUntil unavailable locally */
  }
  const settled = await Promise.race([work, sleep(120000).then(() => null)]);
  return new Response(
    JSON.stringify(settled ?? { status: "running_in_background", note: "see function logs" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});

async function runIngest(supabase: any) {
  const summary: any = {
    started_at: new Date().toISOString(),
    bbox_results: [] as Array<{ box: string; rows: number; error?: string }>,
    readings_parsed: 0,
    readings_inserted: 0,
    stations_matched: 0,
    cmc_samples: 0,
    cmc_inserted: 0,
    cmc_skipped: 0,
    errors: [] as string[],
  };

  // Source of truth for "did the ingest actually run to completion": this row
  // is written from INSIDE the background task at its end (both success and
  // failure paths below call finishRun). cron.job_run_details and
  // net._http_response only see the dispatch, not the background work, so a
  // missing row means the task died mid-flight; a row means it reached the end.
  const finishRun = async (status: "ok" | "ok_with_errors" | "failed", fatal?: unknown) => {
    const row = {
      run_name: "fetch-water-quality",
      started_at: summary.started_at,
      finished_at: summary.finished_at ?? new Date().toISOString(),
      status,
      rows_upserted: (summary.readings_inserted ?? 0) + (summary.cmc_inserted ?? 0),
      tiles_processed:
        summary.tiles_ok ?? (summary.bbox_results as any[]).filter((b: any) => !b.error).length,
      error:
        status === "failed"
          ? String(fatal ?? summary.errors[0] ?? "unknown")
          : summary.errors.length > 0
            ? (summary.errors as string[]).join(" | ").slice(0, 2000)
            : null,
      summary,
    };
    const { error } = await supabase.from("ingest_runs").insert(row);
    if (error) console.error("ingest_runs insert failed:", error.message);
  };

  const tStart = Date.now();
  const tPhase: Record<string, number> = {};
  wqpTiming.http_ms = 0;
  wqpTiming.parse_ms = 0;
  wqpTiming.retry_backoff_ms = 0;
  wqpTiming.tile_pause_ms = 0;
  wqpTiming.attempts = 0;
  wqpTiming.retries = 0;
  wqpTiming.bytes = 0;

  try {
    // The API caps every select at 1000 rows. monitoring_stations has 5000+
    // rows, so an unpaged load silently dropped most stations and their
    // bacteria readings. Page through with .range() until a short page.
    // deno-lint-ignore no-explicit-any
    const loadAll = async (build: () => any, label: string): Promise<any[]> => {
      const PAGE = 1000;
      const out: any[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await build().range(from, from + PAGE - 1);
        if (error) throw new Error(`${label}: ${error.message}`);
        out.push(...(data || []));
        if (!data || data.length < PAGE) break;
      }
      return out;
    };

    const stations = await loadAll(
      () =>
        supabase
          .from("monitoring_stations")
          .select("id, station_code, agency, is_tidal")
          .eq("is_active", true)
          .order("id"),
      "load stations",
    );
    const stationByCode = new Map((stations || []).map((s: any) => [s.station_code, s]));
    summary.stations_loaded = stations.length;

    const assigns = await loadAll(
      () =>
        supabase
          .from("site_station_assignments")
          .select("site_id, station_id, distance_m")
          .lte("distance_m", MAX_MATCH_DISTANCE_M)
          .order("site_id")
          .order("station_id"),
      "load assignments",
    );
    const sitesByStation = new Map<string, string[]>();
    for (const a of assigns || []) {
      const arr = sitesByStation.get(a.station_id) || [];
      arr.push(a.site_id);
      sitesByStation.set(a.station_id, arr);
    }

    // ════════════════════════════════════════════════════════════════════════
    // SOURCE 1 — WQP (EPA Water Quality Portal), bbox-tiled
    // ════════════════════════════════════════════════════════════════════════
    // Load active site coords once, used both to filter tiles (skip empty ocean/
    // land) and later for assignment-backfill.
    const { data: allSiteRows, error: siteLoadErr } = await supabase
      .from("sites")
      .select("id, lat, lng")
      .eq("is_active", true)
      .not("lat", "is", null)
      .not("lng", "is", null);
    if (siteLoadErr) throw new Error(`load sites: ${siteLoadErr.message}`);
    const activeSites = ((allSiteRows || []) as any[])
      .map((r) => ({ id: r.id, lat: Number(r.lat), lng: Number(r.lng) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

    tPhase.db_context_load_ms = Date.now() - tStart;
    const activeTiles = tilesNearSites(BBOXES, activeSites);

    const allReadings: ReturnType<typeof extractReading>[] = [];
    const lo = dateLo();
    summary.tiles_total = BBOXES.length;
    summary.tiles_queried = activeTiles.length;
    summary.tiles_ok = 0;
    summary.tiles_failed = 0;
    const tGrid = Date.now();
    const slowest: Array<{ box: string; ms: number; rows: number }> = [];
    const tileSplits: Array<{
      box: string;
      total_ms: number;
      http_ms: number;
      parse_ms: number;
      sleep_ms: number;
      unaccounted_ms: number;
      bytes: number;
      rows: number;
    }> = [];
    // diagMaxTiles caps the diagnostic (?tiles=N) run to the first N tiles in
    // grid order. Sliced up front, not a mid-pool break, so the pool has a
    // fixed, known-size queue - same N tiles, same order as the old
    // break-after-N-started loop.
    const tilesToRun = diagMaxTiles > 0 ? activeTiles.slice(0, diagMaxTiles) : activeTiles;

    let nextTileIdx = 0;
    let tilesDone = 0;

    const processTile = async (t: { name: string; bbox: string }) => {
      const tileStart = Date.now();
      const url =
        `${WQP_RESULT_URL}?bBox=${encodeURIComponent(t.bbox)}` +
        `&characteristicName=${encodeURIComponent("Escherichia coli")}` +
        `&characteristicName=${encodeURIComponent("Enterococci")}` +
        `&startDateLo=${lo}&mimeType=csv` +
        `&dataProfile=basicPhysChem` +
        `&providers=NWIS&providers=STORET`;
      let result: { ok: boolean; csv?: string; error?: string; httpMs: number; backoffMs: number };
      let tileParseMs = 0;
      let parsed = 0;
      let bytes = 0;
      try {
        result = await fetchTile(url);
        if (!result.ok) {
          summary.tiles_failed++;
          // Only record failed tiles individually to keep the summary small at
          // ~112 tiles; a persistent failure after retries is worth surfacing.
          summary.bbox_results.push({ box: t.name, bbox: t.bbox, rows: 0, error: result.error });
          summary.errors.push(`tile ${t.name} (${t.bbox}): ${result.error}`);
        } else {
          bytes = result.csv!.length;
          const parse0 = Date.now();
          const rows = parseCSV(result.csv!);
          for (const row of rows) {
            const r = extractReading(row);
            if (r) {
              allReadings.push(r);
              parsed++;
            }
          }
          tileParseMs = Date.now() - parse0;
          wqpTiming.parse_ms += tileParseMs;
          summary.tiles_ok++;
          if (parsed > 0) summary.bbox_results.push({ box: t.name, rows: parsed });
        }
      } catch (e) {
        // A tile that throws (e.g. malformed CSV) must not fail the whole
        // pool - record it exactly like an HTTP failure and move on. Without
        // this, one bad tile's exception would reject its lane's promise and
        // Promise.all(lanes) below would abandon every other in-flight lane.
        result = { ok: false, error: String(e), httpMs: 0, backoffMs: 0 };
        summary.tiles_failed++;
        summary.bbox_results.push({ box: t.name, bbox: t.bbox, rows: 0, error: String(e) });
        summary.errors.push(`tile ${t.name} (${t.bbox}): ${e}`);
      }

      // Pace per-lane: was "pause after every tile, serially"; now "pause
      // after every tile, on whichever lane just finished it". Same courtesy
      // interval between successive requests on a given lane; aggregate
      // request rate now scales with WQP_TILE_CONCURRENCY instead of being
      // capped at one request at a time.
      const p0 = Date.now();
      await sleep(WQP_TILE_PAUSE_MS);
      const tileSleepMs = result.backoffMs + (Date.now() - p0);
      wqpTiming.tile_pause_ms += Date.now() - p0;

      const totalMs = Date.now() - tileStart;
      const unaccounted = totalMs - (result.httpMs + tileParseMs + tileSleepMs);
      slowest.push({ box: t.name, ms: totalMs, rows: parsed });
      tileSplits.push({
        box: t.name,
        total_ms: totalMs,
        http_ms: result.httpMs,
        parse_ms: tileParseMs,
        sleep_ms: tileSleepMs,
        unaccounted_ms: unaccounted,
        bytes,
        rows: parsed,
      });
      // Numbered by completion order (not grid position) now that tiles run
      // concurrently - tileSplits/slowest below are likewise appended in
      // completion order. slowest_tiles is re-sorted after the loop so this
      // doesn't affect it; the raw tile_splits array in ingest_runs.summary
      // will look shuffled relative to the grid to a human reader.
      const doneCount = ++tilesDone;
      console.log(
        `[split] tile ${doneCount}/${tilesToRun.length} ${t.name} total=${totalMs}ms http=${result.httpMs}ms parse=${tileParseMs}ms sleep=${tileSleepMs}ms unaccounted=${unaccounted}ms bytes=${bytes} rows=${parsed} elapsed=${Date.now() - tGrid}ms`,
      );
    };

    // Bounded-concurrency worker pool, not fixed batches: the probe showed
    // 1.2s-14.3s variance per tile, so a fixed batch (wait for all N, then
    // start the next N) would sit idle for up to ~13s per wave waiting on one
    // slow tile while other lanes are free. Each lane below pulls the next
    // tile off the queue the instant its own finishes, so up to
    // WQP_TILE_CONCURRENCY requests are in flight continuously.
    async function lane() {
      while (true) {
        const i = nextTileIdx++;
        if (i >= tilesToRun.length) return;
        await processTile(tilesToRun[i]);
      }
    }
    const laneCount = Math.min(WQP_TILE_CONCURRENCY, tilesToRun.length);
    await Promise.all(Array.from({ length: laneCount }, () => lane()));

    summary.tile_splits = tileSplits;

    tPhase.wqp_grid_ms = Date.now() - tGrid;
    summary.slowest_tiles = slowest.sort((a, b) => b.ms - a.ms).slice(0, 10);
    summary.readings_parsed = allReadings.length;

    // ── STATION-CREATE: make stations for WQP codes not yet in the DB ────────
    // Previously, readings whose station wasn't already in monitoring_stations
    // were silently dropped — a major reason MD/VA stayed dark. Every WQX3
    // Result row carries the station's coordinates + metadata, so we create the
    // missing stations here (idempotent on station_code).
    summary.wqp_stations_created = 0;
    const tStationCreate = Date.now();
    {
      const metaByCode = new Map<
        string,
        {
          lat: number | null;
          lng: number | null;
          orgId: string;
          locName: string;
          locType: string;
          huc8: string | null;
          stateCode: string | null;
          isTidal: boolean;
        }
      >();
      for (const r of allReadings) {
        if (!r) continue;
        if (
          !stationByCode.has(r.stationCode) &&
          !metaByCode.has(r.stationCode) &&
          r.lat != null &&
          r.lng != null
        ) {
          metaByCode.set(r.stationCode, {
            lat: r.lat,
            lng: r.lng,
            orgId: r.orgId,
            locName: r.locName,
            locType: r.locType,
            huc8: r.huc8,
            stateCode: r.stateCode,
            isTidal: r.isTidal,
          });
        }
      }
      const newCodes = [...metaByCode.keys()];
      if (newCodes.length > 0) {
        const newRows = newCodes.map((code) => {
          const m = metaByCode.get(code)!;
          return {
            station_code: code,
            station_name: m.locName,
            agency: agencyFromOrg(m.orgId),
            org_identifier: m.orgId,
            data_source: friendlySource(agencyFromOrg(m.orgId)),
            lat: m.lat,
            lng: m.lng,
            state_code: m.stateCode,
            huc8: m.huc8,
            location_type: m.locType,
            is_tidal: m.isTidal,
            is_active: true,
            characteristics: ["Escherichia coli", "Enterococci"],
          };
        });
        const CH = 500;
        for (let i = 0; i < newRows.length; i += CH) {
          const slice = newRows.slice(i, i + CH);
          const { data: created, error: crErr } = await supabase
            .from("monitoring_stations")
            .upsert(slice, { onConflict: "station_code", ignoreDuplicates: false })
            .select("id, station_code, agency, is_tidal");
          if (crErr) {
            summary.errors.push(`station create batch ${i}: ${crErr.message}`);
          } else {
            for (const s of (created || []) as any[]) {
              stationByCode.set(s.station_code, s);
              summary.wqp_stations_created++;
            }
          }
        }
      }
    }
    tPhase.station_create_ms = Date.now() - tStationCreate;

    // ── ASSIGNMENT-BACKFILL: link newly-relevant stations to nearby sites ────
    // A reading only lights a site if a site_station_assignment exists. Stations
    // that just received data but have no assignment get linked to active sites
    // within WQP_ASSIGN_RADIUS_M. Load active sites once.
    summary.wqp_assignments_created = 0;
    const tAssign = Date.now();
    {
      const stationsWithData = new Set<string>();
      for (const r of allReadings) {
        if (!r) continue;
        const st: any = stationByCode.get(r.stationCode);
        if (st) stationsWithData.add(st.id);
      }
      const needAssign = [...stationsWithData].filter((id) => !sitesByStation.has(id));
      if (needAssign.length > 0) {
        // station coords: prefer freshly-created meta, else load from DB.
        const coordById = new Map<string, { lat: number; lng: number }>();
        for (const r of allReadings) {
          if (!r || r.lat == null || r.lng == null) continue;
          const st: any = stationByCode.get(r.stationCode);
          if (st && needAssign.includes(st.id) && !coordById.has(st.id)) {
            coordById.set(st.id, { lat: r.lat, lng: r.lng });
          }
        }
        // any still missing coords -> fetch from DB in chunks
        const missing = needAssign.filter((id) => !coordById.has(id));
        for (let i = 0; i < missing.length; i += 100) {
          const chunk = missing.slice(i, i + 100);
          const { data: rows } = await supabase
            .from("monitoring_stations")
            .select("id, lat, lng")
            .in("id", chunk);
          for (const r of (rows || []) as any[]) {
            if (r.lat != null && r.lng != null)
              coordById.set(r.id, { lat: Number(r.lat), lng: Number(r.lng) });
          }
        }
        // Reuse activeSites loaded above for tile filtering.
        const newAssigns: Record<string, unknown>[] = [];
        for (const stId of needAssign) {
          const sc = coordById.get(stId);
          if (!sc) continue;
          for (const site of activeSites) {
            const d = haversineM(sc.lat, sc.lng, site.lat, site.lng);
            if (d <= WQP_ASSIGN_RADIUS_M) {
              newAssigns.push({ site_id: site.id, station_id: stId, distance_m: Math.round(d) });
            }
          }
        }
        if (newAssigns.length > 0) {
          const CH = 500;
          for (let i = 0; i < newAssigns.length; i += CH) {
            const slice = newAssigns.slice(i, i + CH);
            const { error: naErr, count } = await supabase
              .from("site_station_assignments")
              .upsert(slice, {
                onConflict: "site_id,station_id",
                ignoreDuplicates: true,
                count: "exact",
              });
            if (naErr) summary.errors.push(`assignment batch ${i}: ${naErr.message}`);
            else summary.wqp_assignments_created += count ?? 0;
          }
          for (const a of newAssigns) {
            const arr = sitesByStation.get(a.station_id as string) || [];
            arr.push(a.site_id as string);
            sitesByStation.set(a.station_id as string, arr);
          }
        }
      }
    }
    tPhase.assignment_backfill_ms = Date.now() - tAssign;

    type Merged = { ecoli: number | null; entero: number | null; raw: unknown };
    const merged = new Map<string, Merged>();
    for (const r of allReadings) {
      if (!r) continue;
      const key = `${r.stationCode}|${r.sampledAt}`;
      const m = merged.get(key) || { ecoli: null, entero: null, raw: r.raw };
      if (r.ecoli != null) m.ecoli = r.ecoli;
      if (r.entero != null) m.entero = r.entero;
      merged.set(key, m);
    }

    const toInsert: Record<string, unknown>[] = [];
    for (const [key, m] of merged) {
      const [stationCode, sampledAt] = key.split("|");
      const station: any = stationByCode.get(stationCode);
      if (!station) continue;
      const siteIds = sitesByStation.get(station.id) || [];
      if (siteIds.length === 0) continue;
      const status = classify(station.is_tidal, m.ecoli, m.entero);
      const ds = friendlySource(station.agency);
      const srcUrl = `https://www.waterqualitydata.us/wqx3/Result/search?siteid=${encodeURIComponent(stationCode)}`;
      for (const siteId of siteIds) {
        toInsert.push({
          site_id: siteId,
          monitoring_station_id: station.id,
          sampled_at: sampledAt,
          e_coli_mpn: m.ecoli,
          enterococci_cce: m.entero,
          sample_method: "lab",
          data_source: ds,
          source_url: srcUrl,
          status,
          raw_payload: m.raw,
        });
      }
    }
    summary.stations_matched = new Set(toInsert.map((r) => r.monitoring_station_id)).size;

    const tUpsert = Date.now();
    if (toInsert.length) {
      const BATCH = 500;
      for (let i = 0; i < toInsert.length; i += BATCH) {
        const slice = toInsert.slice(i, i + BATCH);
        const { error: insErr, count } = await supabase.from("readings").upsert(slice, {
          onConflict: "site_id,sampled_at,data_source",
          ignoreDuplicates: true,
          count: "exact",
        });
        if (insErr) {
          summary.errors.push(`insert batch ${i}: ${insErr.message}`);
        } else {
          summary.readings_inserted += count ?? 0;
        }
      }
    }
    tPhase.readings_upsert_ms = Date.now() - tUpsert;

    // Track latest sample per station (for the freshness indicator on map markers).
    const latestByStation = new Map<string, string>();
    for (const [key] of merged) {
      const [code, sampledAt] = key.split("|");
      const st: any = stationByCode.get(code);
      if (!st) continue;
      const prev = latestByStation.get(st.id);
      if (!prev || sampledAt > prev) latestByStation.set(st.id, sampledAt);
    }

    // ════════════════════════════════════════════════════════════════════════
    // SOURCE 2 — CMC Data Explorer (direct community-science E. coli)
    // POST JSON, no auth. One record per sample. Station codes map to the
    // WQP-prefixed station_code already in monitoring_stations.
    // ════════════════════════════════════════════════════════════════════════
    const tCmc = Date.now();
    try {
      const cmcSamples = await fetchFromCMC(LOOKBACK_DAYS);

      summary.cmc_samples = cmcSamples.length;

      if (cmcSamples.length > 0) {
        // Batch-resolve CMC short codes → monitoring_stations.id
        const uniqueCodes = [...new Set(cmcSamples.map((s) => s.stationCode))];
        const wqpCodes = uniqueCodes.map((c) => `${CMC_WQP_PREFIX}${c}`);

        const { data: msRows } = await supabase
          .from("monitoring_stations")
          .select("id, station_code")
          .in("station_code", wqpCodes);

        const cmcCodeToStationId = new Map<string, string>();
        for (const ms of (msRows || []) as any[]) {
          cmcCodeToStationId.set(ms.station_code.replace(CMC_WQP_PREFIX, ""), ms.id);
        }
        console.log(`[CMC] Matched ${cmcCodeToStationId.size}/${uniqueCodes.length} station codes`);

        // Proximity fallback for CMC stations added after the initial WQP load.
        const unmatched = uniqueCodes.filter((c) => !cmcCodeToStationId.has(c));
        summary.cmc_proximity_lookups = unmatched.length;
        if (unmatched.length > 0) {
          const PROX_KM = 5;
          // One bbox query covering every unmatched sample, then match in
          // memory — previously one round trip per unmatched station code.
          const pts = unmatched
            .map((code) => ({ code, s: cmcSamples.find((x) => x.stationCode === code) }))
            .filter((p) => p.s && p.s.lat != null && p.s.long != null) as Array<{
            code: string;
            s: { lat: number; long: number };
          }>;
          if (pts.length > 0) {
            const latD = PROX_KM / 111.0;
            const minLat = Math.min(...pts.map((p) => p.s.lat)) - latD;
            const maxLat = Math.max(...pts.map((p) => p.s.lat)) + latD;
            const widestLngD =
              PROX_KM /
              (111.0 * Math.cos((Math.max(Math.abs(minLat), Math.abs(maxLat)) * Math.PI) / 180));
            const minLng = Math.min(...pts.map((p) => p.s.long)) - widestLngD;
            const maxLng = Math.max(...pts.map((p) => p.s.long)) + widestLngD;
            // Paged: the bbox spans the whole region and exceeds 1000 rows.
            const cands = await loadAll(
              () =>
                supabase
                  .from("monitoring_stations")
                  .select("id, lat, lng")
                  .gte("lat", minLat)
                  .lte("lat", maxLat)
                  .gte("lng", minLng)
                  .lte("lng", maxLng)
                  .order("id"),
              "load CMC candidates",
            );
            const candList = ((cands || []) as any[]).filter((c) => c.lat != null && c.lng != null);
            for (const { code, s } of pts) {
              let bestId: string | null = null;
              let bestDist = Infinity;
              for (const c of candList) {
                const dist = haversineM(s.lat, s.long, Number(c.lat), Number(c.lng)) / 1000;
                if (dist < bestDist) {
                  bestDist = dist;
                  bestId = c.id;
                }
              }
              if (bestId && bestDist <= PROX_KM) {
                cmcCodeToStationId.set(code, bestId);
                console.log(
                  `[CMC] Proximity matched ${code} → ${bestId} (${bestDist.toFixed(2)} km)`,
                );
              }
            }
          }
        }

        // Build CMC reading rows.
        const cmcToInsert: Record<string, unknown>[] = [];
        for (const sample of cmcSamples) {
          const stationId = cmcCodeToStationId.get(sample.stationCode);
          if (!stationId) {
            summary.cmc_skipped++;
            continue;
          }
          const siteIds = sitesByStation.get(stationId) || [];
          if (siteIds.length === 0) {
            summary.cmc_skipped++;
            continue;
          }

          const status = classifyCMC(sample.ecoliMpn);
          for (const siteId of siteIds) {
            cmcToInsert.push({
              site_id: siteId,
              monitoring_station_id: stationId,
              sampled_at: sample.sampledAt,
              e_coli_mpn: sample.ecoliMpn,
              enterococci_cce: null,
              sample_method: "lab",
              data_source: sample.dataSource,
              source_url: "https://cmc.vims.edu/data-explorer",
              status,
              raw_payload: sample.rawRow,
              notes: `CMC ${sample.groupCode} / ${sample.stationCode} / ${sample.parameterCode} / sampleId ${sample.sampleId}`,
            });
          }

          // Fold CMC freshness into the same last_sample_at map.
          const prev = latestByStation.get(stationId);
          if (!prev || sample.sampledAt > prev) latestByStation.set(stationId, sample.sampledAt);
        }

        if (cmcToInsert.length) {
          const BATCH = 500;
          for (let i = 0; i < cmcToInsert.length; i += BATCH) {
            const slice = cmcToInsert.slice(i, i + BATCH);
            const { error: cmcErr, count } = await supabase.from("readings").upsert(slice, {
              onConflict: "site_id,sampled_at,data_source",
              ignoreDuplicates: true,
              count: "exact",
            });
            if (cmcErr) {
              summary.errors.push(`CMC insert batch ${i}: ${cmcErr.message}`);
            } else {
              summary.cmc_inserted += count ?? 0;
            }
          }
        }
      }
    } catch (e) {
      summary.errors.push(`CMC adapter: ${e}`);
      console.error("[CMC] adapter error:", e);
    }

    tPhase.cmc_ms = Date.now() - tCmc;

    // ── Update last_sample_at for all touched stations (WQP + CMC) ──────────
    // Single set-based RPC (UPDATE ... FROM jsonb_array_elements) instead of
    // one round trip per station: 273 stations went from ~5.6s to one call.
    const tLast = Date.now();
    summary.last_sample_at_stations = latestByStation.size;
    if (latestByStation.size > 0) {
      const payload = [...latestByStation].map(([id, ts]) => ({ id, ts }));
      const { data: updatedCount, error: lsErr } = await supabase.rpc(
        "bulk_update_last_sample_at",
        { p_rows: payload },
      );
      if (lsErr) summary.errors.push(`last_sample_at bulk update: ${lsErr.message}`);
      else summary.last_sample_at_updated = updatedCount ?? 0;
    }
    tPhase.last_sample_at_ms = Date.now() - tLast;
    tPhase.total_ms = Date.now() - tStart;
    summary.timing_ms = tPhase;
    summary.wqp_fetch_detail = wqpTiming;

    summary.finished_at = new Date().toISOString();
    // Compact, log-safe distribution of per-tile HTTP time. The full
    // tile_splits array overflows the log line, so summarise it here.
    const httpTimes = tileSplits.map((t: any) => t.http_ms).sort((a, b) => a - b);
    if (httpTimes.length > 0) {
      const mid = Math.floor(httpTimes.length / 2);
      summary.http_ms_stats = {
        tiles: httpTimes.length,
        min: httpTimes[0],
        median:
          httpTimes.length % 2 === 0
            ? Math.round((httpTimes[mid - 1] + httpTimes[mid]) / 2)
            : httpTimes[mid],
        max: httpTimes[httpTimes.length - 1],
        slowest_5: [...tileSplits]
          .sort((a: any, b: any) => b.http_ms - a.http_ms)
          .slice(0, 5)
          .map((t: any) => ({ box: t.box, http_ms: t.http_ms, bytes: t.bytes, rows: t.rows })),
      };
      console.log("fetch-water-quality http_stats:", JSON.stringify(summary.http_ms_stats));
    }
    console.log("fetch-water-quality timing:", JSON.stringify({ ...tPhase, wqp: wqpTiming }));
    console.log("fetch-water-quality summary:", JSON.stringify(summary));

    // Reached the end of a successful run — log it before returning.
    await finishRun(summary.errors.length > 0 ? "ok_with_errors" : "ok");
    return summary;
  } catch (e) {
    summary.errors.push(String(e));
    summary.timing_ms = { ...tPhase, total_ms: Date.now() - tStart };
    summary.wqp_fetch_detail = wqpTiming;
    console.error("fetch-water-quality FAILED:", e);
    await finishRun("failed", e);
    return summary;
  }
}
