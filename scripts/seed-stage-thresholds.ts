/**
 * One-time seed script: fetches flood/action stage data from the USGS API
 * for all non-tidal river_gauges that do not already have a stage_thresholds
 * row, then inserts thresholds using USGS data where available.
 *
 * Run with:
 *   npx tsx scripts/seed-stage-thresholds.ts
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (or environment).
 * The script is idempotent — existing thresholds are never overwritten.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// .env loader
// ---------------------------------------------------------------------------
function loadDotenv(): void {
  for (const filename of [".env", ".env.local"]) {
    try {
      const content = readFileSync(resolve(process.cwd(), filename), "utf8");
      for (const raw of content.split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        const val = line
          .slice(eq + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
        if (key && !(key in process.env)) process.env[key] = val;
      }
    } catch {
      // File not found — continue
    }
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface GaugeRow {
  id: string;
  usgs_site_number: string;
  name: string;
}

type ThresholdSource =
  | "USGS action stage + p25/p75 percentiles"
  | "USGS action stage; optimal range estimated"
  | "USGS p25/p75 percentiles; caution estimated"
  | "Default recreational thresholds — not validated";

interface ThresholdRow {
  id: string;
  station_id: string;
  too_low_ft: number;
  optimal_min_ft: number;
  optimal_max_ft: number;
  caution_max_ft: number;
  notes: ThresholdSource;
}

// ---------------------------------------------------------------------------
// USGS site service — attempt to extract action/flood stage
//
// The USGS site service response can include threshold options embedded in
// variable.options.option[] for some gauges. Action stage (00058) is present
// on stations that report to NWS AHPS. This is absent for most gauges, so the
// function falls through gracefully.
// ---------------------------------------------------------------------------
async function fetchUsgsActionStage(siteNumber: string): Promise<number | null> {
  const url =
    `https://waterservices.usgs.gov/nwis/site/?format=json&sites=${siteNumber}` +
    `&parameterCd=00065&siteStatus=active&hasDataTypeCd=iv`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      value?: {
        timeSeries?: Array<{
          variable?: {
            options?: {
              option?: Array<{
                name?: string;
                optionCode?: string;
                value?: string | number;
              }>;
            };
          };
        }>;
      };
    };

    const series = data?.value?.timeSeries ?? [];
    for (const ts of series) {
      const options = ts?.variable?.options?.option ?? [];
      for (const opt of options) {
        const name = (opt.name ?? "").toLowerCase();
        const isActionStage =
          name.includes("action") || name.includes("flood") || opt.optionCode === "00058";
        if (isActionStage) {
          const v = parseFloat(String(opt.value ?? ""));
          if (Number.isFinite(v) && v > 0) return v;
        }
      }
    }
  } catch {
    // Network / timeout — treated as unavailable
  }
  return null;
}

// ---------------------------------------------------------------------------
// USGS statistics service — fetch p25 and p75 daily percentiles
//
// The stats endpoint returns up to 365 daily percentile values (one per day
// of year). We take the median across all days as the representative value
// for threshold setting, which is more robust than the mean against seasonal
// extremes.
// ---------------------------------------------------------------------------
function medianOf(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function fetchUsgsPercentiles(
  siteNumber: string,
): Promise<{ p25: number | null; p75: number | null }> {
  const url =
    `https://waterservices.usgs.gov/nwis/stat/?format=json&sites=${siteNumber}` +
    `&parameterCd=00065&statReportType=daily&statType=p25,p75`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { p25: null, p75: null };

    const data = (await res.json()) as {
      value?: {
        timeSeries?: Array<{
          variable?: { variableCode?: Array<{ value?: string }> };
          values?: Array<{
            value?: Array<{ value?: string; qualifiers?: string[] }>;
          }>;
        }>;
      };
    };

    // Keep only the gage-height (00065) time series
    const series = (data?.value?.timeSeries ?? []).filter(
      (ts) => ts?.variable?.variableCode?.[0]?.value === "00065",
    );
    if (series.length === 0) return { p25: null, p75: null };

    // Extract numeric values and the first qualifiers list per series
    const extracted = series.map((ts) => {
      const raw = ts?.values?.[0]?.value ?? [];
      const qualifiers = (raw[0]?.qualifiers ?? []).map((q: string) => q.toUpperCase());
      const nums = raw
        .map((v) => parseFloat(v.value ?? ""))
        .filter((v) => Number.isFinite(v) && v >= 0);
      return { qualifiers, nums };
    });

    let p25Nums: number[] = [];
    let p75Nums: number[] = [];

    // Primary: distinguish by qualifier strings (e.g. ["P25"] or ["P75"])
    for (const { qualifiers, nums } of extracted) {
      const qStr = qualifiers.join(",");
      if (qStr.includes("P25")) p25Nums = nums;
      else if (qStr.includes("P75")) p75Nums = nums;
    }

    // Fallback: use positional order when qualifiers don't identify percentiles
    if (p25Nums.length === 0 && p75Nums.length === 0) {
      if (extracted.length >= 2) {
        p25Nums = extracted[0].nums;
        p75Nums = extracted[1].nums;
      }
    }

    return { p25: medianOf(p25Nums), p75: medianOf(p75Nums) };
  } catch {
    return { p25: null, p75: null };
  }
}

// ---------------------------------------------------------------------------
// Threshold logic
// ---------------------------------------------------------------------------
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function buildThreshold(
  gaugeId: string,
  actionStage: number | null,
  p25: number | null,
  p75: number | null,
): ThresholdRow {
  const hasAction = actionStage !== null && actionStage > 0;
  const hasPercentiles = p25 !== null && p75 !== null && p25 > 0 && p75 > 0 && p75 > p25;

  let too_low_ft: number;
  let optimal_min_ft: number;
  let optimal_max_ft: number;
  let caution_max_ft: number;
  let notes: ThresholdSource;

  if (hasAction && hasPercentiles) {
    too_low_ft = round2(p25! * 0.5);
    optimal_min_ft = round2(p25!);
    optimal_max_ft = round2(p75!);
    caution_max_ft = round2(actionStage!);
    notes = "USGS action stage + p25/p75 percentiles";
  } else if (hasAction) {
    too_low_ft = 0.5;
    optimal_min_ft = 1.0;
    optimal_max_ft = round2(actionStage! * 0.6);
    caution_max_ft = round2(actionStage!);
    notes = "USGS action stage; optimal range estimated";
  } else if (hasPercentiles) {
    too_low_ft = round2(p25! * 0.5);
    optimal_min_ft = round2(p25!);
    optimal_max_ft = round2(p75!);
    caution_max_ft = round2(p75! * 1.5);
    notes = "USGS p25/p75 percentiles; caution estimated";
  } else {
    too_low_ft = 0.5;
    optimal_min_ft = 1.0;
    optimal_max_ft = 5.0;
    caution_max_ft = 8.0;
    notes = "Default recreational thresholds — not validated";
  }

  return {
    id: randomUUID(),
    station_id: gaugeId,
    too_low_ft,
    optimal_min_ft,
    optimal_max_ft,
    caution_max_ft,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  loadDotenv();

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error(
      "Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env or environment.",
    );
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Step 1 — Load all non-tidal, non-NOAA gauges
  const { data: allGauges, error: gaugeErr } = await db
    .from("river_gauges")
    .select("id, usgs_site_number, name")
    .eq("is_tidal", false)
    .not("usgs_site_number", "like", "NOAA-%")
    .not("usgs_site_number", "is", null);

  if (gaugeErr) {
    console.error("Failed to load river_gauges:", gaugeErr.message);
    process.exit(1);
  }
  if (!allGauges || allGauges.length === 0) {
    console.log("No non-tidal gauges found.");
    return;
  }

  // Determine which station_ids already have thresholds
  const { data: existing, error: existErr } = await db
    .from("stage_thresholds")
    .select("station_id");

  if (existErr) {
    console.error("Failed to load existing stage_thresholds:", existErr.message);
    process.exit(1);
  }

  const existingIds = new Set((existing ?? []).map((r: { station_id: string }) => r.station_id));

  const skipped = (allGauges as GaugeRow[]).filter((g) => existingIds.has(g.id));
  const toProcess = (allGauges as GaugeRow[]).filter((g) => !existingIds.has(g.id));

  console.log(`\nTotal non-tidal gauges:  ${allGauges.length}`);
  console.log(`Already have thresholds: ${skipped.length}`);
  console.log(`Gauges to process:       ${toProcess.length}\n`);

  // Log skipped gauges
  for (const g of skipped) {
    console.log(`✗ ${g.name} — skipped (already exists)`);
  }
  if (skipped.length > 0) console.log("");

  if (toProcess.length === 0) {
    console.log("All gauges already have thresholds. Nothing to do.");
    printSummary(allGauges.length, 0, 0, 0, 0, skipped.length, 0);
    return;
  }

  // Steps 2–4 — Fetch USGS data in batches of 10, insert rows
  const BATCH_SIZE = 10;
  const counters = {
    actionAndPercentiles: 0,
    actionOnly: 0,
    percentilesOnly: 0,
    defaults: 0,
    errors: 0,
  };
  const rows: ThresholdRow[] = [];

  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1_000));

    const batch = toProcess.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (gauge) => {
        try {
          const [actionStage, { p25, p75 }] = await Promise.all([
            fetchUsgsActionStage(gauge.usgs_site_number),
            fetchUsgsPercentiles(gauge.usgs_site_number),
          ]);

          const row = buildThreshold(gauge.id, actionStage, p25, p75);
          rows.push(row);

          if (row.notes === "USGS action stage + p25/p75 percentiles") {
            counters.actionAndPercentiles++;
          } else if (row.notes === "USGS action stage; optimal range estimated") {
            counters.actionOnly++;
          } else if (row.notes === "USGS p25/p75 percentiles; caution estimated") {
            counters.percentilesOnly++;
          } else {
            counters.defaults++;
          }

          console.log(`✓ ${gauge.name} — source: ${row.notes}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`  ERROR: ${gauge.name} (${gauge.usgs_site_number}): ${message}`);
          counters.errors++;
        }
      }),
    );
  }

  // Upsert — ON CONFLICT (station_id) DO NOTHING prevents overwriting validated thresholds
  if (rows.length > 0) {
    const { error: upsertErr } = await db
      .from("stage_thresholds")
      .upsert(rows, { onConflict: "station_id", ignoreDuplicates: true });

    if (upsertErr) {
      console.error("\nUpsert failed:", upsertErr.message);
      process.exit(1);
    }
  }

  // Step 5 — Summary
  const withAction = counters.actionAndPercentiles + counters.actionOnly;
  const withPercentiles = counters.actionAndPercentiles + counters.percentilesOnly;

  printSummary(
    toProcess.length,
    withAction,
    withPercentiles,
    counters.defaults,
    skipped.length,
    skipped.length,
    counters.errors,
  );
}

function printSummary(
  processed: number,
  withAction: number,
  withPercentiles: number,
  defaults: number,
  _skippedArg: number,
  skippedExisted: number,
  errors: number,
): void {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Summary");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`Total gauges processed:              ${processed}`);
  console.log(`Thresholds from USGS action stage:   ${withAction}`);
  console.log(`Thresholds from USGS percentiles:    ${withPercentiles}`);
  console.log(`Thresholds from defaults:            ${defaults}`);
  console.log(`Skipped (already existed):           ${skippedExisted}`);
  console.log(`Errors:                              ${errors}`);
}

main().catch((err: unknown) => {
  console.error("Unexpected error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
