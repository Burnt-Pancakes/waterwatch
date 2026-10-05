// cmc-adapter.ts
// CMC (Chesapeake Monitoring Cooperative) Data Explorer adapter for WaterVoice DMV.
// Source: https://cmc2.vims.edu/DashboardApi/ — public JSON API, no auth, CORS open.
//
// ═══════════════════════════════════════════════════════════════════════════════
// API CONTRACT — confirmed from DevTools capture 2026-06-23
// ═══════════════════════════════════════════════════════════════════════════════
//
// Endpoint:  POST https://cmc2.vims.edu/DashboardApi/FetchSamplesForDownload
// Auth:      None  (Access-Control-Allow-Origin: *)
// Survey:    NOT required — 200 OK without record_data_use_survey_download
// Response:  text/json; charset=utf-8
//
// Request payload (same universal filter shape as all other DashboardApi endpoints):
//   {
//     "dataType":     "Water Quality",
//     "groups":       "",        // empty = all monitoring groups
//     "stations":     "",
//     "states":       "",
//     "counties":     "",
//     "watersheds":   "Potomac,Upper Chesapeake,Lower Chesapeake,James",
//     "subwatersheds":"",
//     "startDate":    "YYYY-MM-DD",
//     "endDate":      "YYYY-MM-DD",
//     "parameters":   "319, 229, 476, 501, 422, 430, 516"
//   }
//
// Response shape: flat JSON array — NORMALIZED (one row per parameter per sample):
//   {
//     "StationId":      "992",
//     "StationCode":    "ARK.AR.2",         ← CMC short code; suffix of WQP CHESAPEAKEMONITORINGCOOP-CMC.*
//     "StationName":    "AR.2",
//     "Lat":            38.9098000000,       ← included in every sample row — no separate station lookup needed
//     "Long":           -76.9618000000,
//     "GroupCode":      "ARK",              ← monitoring group (ARK, PRK, ACB, etc.)
//     "DateTime":       "2018-09-26 08:53:00.000",   ← Eastern local time, no tz marker
//     "Date":           "2018-09-26",
//     "Time":           "08:53:00.000",
//     "SampleDepth":    0.3000000000,
//     "SampleId":       "1",
//     "ParameterCode":  "ECOLI.8",          ← one row per ParameterCode (not 7 wide columns like the CSV)
//     "ParameterName":  "Bacteria (E.Coli)",
//     "ParameterUnits": "MPN",
//     "Value":          1046.2000000000,    ← E. coli MPN/100mL — THIS IS THE READING
//     "ProblemCode":    "",                ← non-empty = QA flag; skip these rows
//     "QualifierCode":  "",
//     "Comments":       ""
//   }
//
// NOTE: No coalescing needed (unlike the CSV which had 7 ECOLI columns per row).
//       Filter rows where ParameterCode starts with "ECOLI" — all 7 codes are
//       valid E. coli measurements and use the same MPN unit.
// ═══════════════════════════════════════════════════════════════════════════════

const CMC_BASE = "https://cmc2.vims.edu/DashboardApi";

// 7 E. coli parameter IDs confirmed from payload capture (order matches observed request)
const ECOLI_PARAMS = "319, 229, 476, 501, 422, 430, 516";

// DMV-relevant basins. Excludes upper Susquehanna / WV basins not relevant to paddle sites.
const DMV_WATERSHEDS = "Potomac,Upper Chesapeake,Lower Chesapeake,James";

// EPA freshwater E. coli thresholds (MPN ≈ CFU for Colilert purposes)
const EPA_GM_THRESHOLD = 235; // geometric mean threshold → caution
const EPA_STV_THRESHOLD = 410; // statistical threshold value → unsafe

// CMC GroupCode → friendly display name for readings.data_source
const GROUP_DISPLAY: Record<string, string> = {
  ARK: "Anacostia Riverkeeper",
  PRK: "Potomac Riverkeeper",
  ACB: "Anacostia Community Boathouse",
  FMR: "Friends of the Rappahannock",
  SHR: "Shenandoah Riverkeeper",
  TWC: "Two Creeks",
};

function groupToDataSource(groupCode: string): string {
  return GROUP_DISPLAY[groupCode] ?? `CMC / ${groupCode}`;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CmcSample {
  stationCode: string; // e.g. "ARK.AR.2"
  stationName: string;
  lat: number;
  long: number;
  groupCode: string;
  dataSource: string; // friendly name for readings.data_source
  sampledAt: string; // ISO 8601 — DateTime treated as Eastern local, stored with Z
  ecoliMpn: number; // MPN/100mL
  parameterCode: string; // e.g. "ECOLI.8"
  sampleId: string;
  rawRow: Record<string, unknown>; // full original record for raw_payload
}

export type EcoliStatus = "pass" | "caution" | "unsafe";

export function classifyStatus(mpn: number): EcoliStatus {
  if (mpn >= EPA_STV_THRESHOLD) return "unsafe";
  if (mpn >= EPA_GM_THRESHOLD) return "caution";
  return "pass";
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Convert CMC DateTime ("2018-09-26 08:53:00.000") to ISO 8601.
 * CMC times are Eastern local (no tz marker). We append Z so Postgres stores
 * a consistent UTC-equivalent. The ~4-5h offset is acceptable for advisory
 * purposes; dedup key (site_id, sampled_at, data_source) will remain unique
 * because CMC typically takes one sample per station visit.
 * Fall back to Date-only ("2018-09-26T00:00:00.000Z") if DateTime is absent.
 */
function parseSampledAt(row: Record<string, unknown>): string {
  const dt = String(row["DateTime"] ?? "").trim();
  if (dt && dt !== "null") {
    // "2018-09-26 08:53:00.000" → "2018-09-26T08:53:00.000Z"
    return dt.replace(" ", "T") + "Z";
  }
  const d = String(row["Date"] ?? "").trim();
  if (d && d !== "null") {
    return `${d}T00:00:00.000Z`;
  }
  return new Date().toISOString(); // fallback (should never reach here)
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Pull recent E. coli samples from the CMC Data Explorer.
 *
 * Returns flat CmcSample[]; the caller (index.ts) maps stationCode → monitoring_station_id
 * via site_station_assignments, then inserts into readings.
 *
 * @param lookbackDays  Rolling window. Keep aligned with LOOKBACK_DAYS in index.ts (90).
 */
export async function fetchFromCMC(lookbackDays = 90): Promise<CmcSample[]> {
  const end = new Date();
  const start = new Date(end.getTime() - lookbackDays * 86_400_000);

  const payload = {
    dataType: "Water Quality",
    groups: "", // empty = all monitoring groups
    stations: "",
    states: "",
    counties: "",
    watersheds: DMV_WATERSHEDS,
    subwatersheds: "",
    startDate: fmtDate(start),
    endDate: fmtDate(end),
    parameters: ECOLI_PARAMS,
  };

  console.log(`[CMC] Fetching ${lookbackDays}d window: ${payload.startDate} → ${payload.endDate}`);

  const res = await fetch(`${CMC_BASE}/FetchSamplesForDownload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`[CMC] FetchSamplesForDownload HTTP ${res.status} ${res.statusText}`);
  }

  const rows: unknown = await res.json();

  if (!Array.isArray(rows)) {
    console.error(
      "[CMC] Unexpected response — not an array. Top-level keys:",
      Object.keys((rows as Record<string, unknown>) ?? {}),
    );
    return [];
  }

  console.log(`[CMC] Raw rows: ${rows.length}`);

  const samples: CmcSample[] = [];
  let skippedProblem = 0;
  let skippedNoValue = 0;
  let skippedBadParam = 0;

  for (const raw of rows as Record<string, unknown>[]) {
    // Only process E. coli parameters
    const paramCode = String(raw["ParameterCode"] ?? "")
      .trim()
      .toUpperCase();
    if (!paramCode.startsWith("ECOLI")) {
      skippedBadParam++;
      continue;
    }

    // Skip QA-flagged samples
    const problemCode = String(raw["ProblemCode"] ?? "").trim();
    if (problemCode !== "") {
      skippedProblem++;
      continue;
    }

    // Extract and validate the E. coli value
    const valueRaw = raw["Value"];
    const mpn = typeof valueRaw === "number" ? valueRaw : parseFloat(String(valueRaw ?? ""));

    if (!isFinite(mpn) || mpn < 0) {
      skippedNoValue++;
      continue;
    }

    const stationCode = String(raw["StationCode"] ?? "").trim();
    const groupCode = String(raw["GroupCode"] ?? "").trim();

    if (!stationCode) {
      skippedNoValue++;
      continue;
    }

    samples.push({
      stationCode,
      stationName: String(raw["StationName"] ?? ""),
      lat: Number(raw["Lat"] ?? 0),
      long: Number(raw["Long"] ?? 0),
      groupCode,
      dataSource: groupToDataSource(groupCode),
      sampledAt: parseSampledAt(raw),
      ecoliMpn: mpn,
      parameterCode: String(raw["ParameterCode"] ?? ""),
      sampleId: String(raw["SampleId"] ?? ""),
      rawRow: raw,
    });
  }

  console.log(
    `[CMC] Valid: ${samples.length} | Skipped — problem: ${skippedProblem}, no value: ${skippedNoValue}, wrong param: ${skippedBadParam}`,
  );

  return samples;
}
