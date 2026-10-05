/**
 * fetch-rainfall — measured rainfall for the DMV rain advisory.
 *
 * Pulls 48h and 24h precipitation totals from three NWS reference stations
 * (KDCA, KBWI, KDULLES), averages across whichever stations respond, and
 * writes one row to rain_events.
 *
 * Ported from src/lib/adapters/noaaRainAdapter.ts (NoaaRainAdapter), which
 * has never actually run: its default fetchJson sends only an Accept header,
 * and api.weather.gov returns 403 on every request without a User-Agent.
 * This function uses the same NWS_HEADERS shape as fetch-weather/index.ts:30-33.
 *
 * fetch-weather/index.ts previously wrote to rain_events from forecast
 * probabilityOfPrecipitation - removed, because forecast probability is not
 * a rainfall measurement. This function is the sole intended writer to
 * rain_events going forward. noaaRainAdapter.ts is not yet deleted.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");

const NWS_BASE = "https://api.weather.gov";
const NOAA_STATIONS = ["KDCA", "KBWI", "KDULLES"] as const;

// Must match RAIN_THRESHOLD_INCHES_48H in src/lib/waterQualityEngine.ts. This
// function runs in Deno and cannot import from src/ - same constraint as the
// EPA thresholds duplicated in fetch-water-quality/index.ts and
// ingest-cmc/index.ts. Keep this value in sync by hand if the source changes.
const RAIN_THRESHOLD_INCHES_48H = 1.0;

// api.weather.gov 403s every request without a descriptive User-Agent.
// Same shape as fetch-weather/index.ts:30-33.
const NWS_HEADERS = {
  "User-Agent": "watervoice-dmv (contact@watervoice.app)",
  Accept: "application/geo+json",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NwsObservation {
  properties?: {
    timestamp?: string;
    precipitationLast6Hours?: { value: number | null; unitCode?: string };
  };
}

interface NwsObservationCollection {
  features?: NwsObservation[];
}

/** Convert NWS metric values (mm) into inches; passes unknown units through. */
function metricToInches(value: number, unitCode: string | undefined): number {
  if (!unitCode) return value;
  if (unitCode.endsWith("mm") || unitCode.endsWith(":mm")) return value / 25.4;
  if (unitCode.endsWith("m") || unitCode.endsWith(":m")) return (value * 1000) / 25.4;
  return value;
}

/**
 * Sum 6-hour precipitation buckets over the trailing 48 hours.
 * Nulls in the feed are treated as zero (NWS reports null for "no precip"
 * just as often as a true measurement gap; treating null as 0 is the
 * conservative choice for an advisory threshold because it under-reports
 * rain rather than triggering false alerts).
 */
function sumLast48h(collection: NwsObservationCollection, now: Date): number {
  const cutoff = now.getTime() - 48 * 3600_000;
  let total = 0;
  for (const f of collection.features ?? []) {
    const ts = f.properties?.timestamp ? Date.parse(f.properties.timestamp) : NaN;
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    const p = f.properties?.precipitationLast6Hours;
    if (!p || p.value === null || p.value === undefined) continue;
    total += metricToInches(p.value, p.unitCode);
  }
  return total;
}

/** Sum 6-hour precipitation buckets over the trailing 24 hours. Same null handling as sumLast48h. */
function sumLast24h(collection: NwsObservationCollection, now: Date): number {
  const cutoff = now.getTime() - 24 * 3600_000;
  let total = 0;
  for (const f of collection.features ?? []) {
    const ts = f.properties?.timestamp ? Date.parse(f.properties.timestamp) : NaN;
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    const p = f.properties?.precipitationLast6Hours;
    if (!p || p.value === null || p.value === undefined) continue;
    total += metricToInches(p.value, p.unitCode);
  }
  return total;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth model matches fetch-water-quality (checked), NOT fetch-water-conditions
  // (which has none) - only the ingest_runs shape below is ported from the
  // latter. The cron dispatch for this function needs a valid Authorization
  // for the gateway; x-cron-secret is the actual per-function check.
  const authHeader = req.headers.get("Authorization");
  const xCronSecret = req.headers.get("x-cron-secret");
  const isAuthorized =
    authHeader === `Bearer ${SERVICE_KEY}` ||
    (CRON_SECRET !== undefined && xCronSecret === CRON_SECRET);
  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const errors: string[] = [];
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const startedAt = new Date().toISOString();

  // Source of truth for "did this ingest actually finish" - written at the
  // end of both the success and failure paths, matching fetch-water-conditions.
  // cron.job_run_details / net._http_response only ever see the dispatch.
  const finishRun = async (
    status: "ok" | "ok_with_errors" | "failed",
    rowsUpserted: number,
    summary: unknown,
    fatal?: unknown,
  ) => {
    const { error } = await db.from("ingest_runs").insert({
      run_name: "fetch-rainfall",
      function_name: "fetch-rainfall",
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status,
      rows_upserted: rowsUpserted,
      tiles_processed: 0,
      error:
        status === "failed"
          ? String(fatal ?? errors[0] ?? "unknown")
          : errors.length > 0
            ? errors.join(" | ").slice(0, 2000)
            : null,
      summary,
    });
    if (error) console.error("ingest_runs insert failed:", error.message);
  };

  try {
    const now = new Date();

    const perStation = await Promise.all(
      NOAA_STATIONS.map(async (station) => {
        const url = `${NWS_BASE}/stations/${station}/observations`;
        try {
          const res = await fetch(url, { headers: NWS_HEADERS });
          if (!res.ok) throw new Error(`NWS ${res.status} ${res.statusText}`);
          const payload = (await res.json()) as NwsObservationCollection;
          return {
            station,
            h48: sumLast48h(payload, now),
            h24: sumLast24h(payload, now),
          };
        } catch (err) {
          // One station outage shouldn't kill the average - log and skip.
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`${station}: ${message}`);
          console.warn(`[fetch-rainfall] ${station} fetch failed: ${message}`);
          return null;
        }
      }),
    );

    const valid = perStation.filter(
      (v): v is { station: string; h48: number; h24: number } => v !== null,
    );
    if (valid.length === 0) {
      throw new Error("all reference stations failed");
    }

    const avg48 = valid.reduce((a, b) => a + b.h48, 0) / valid.length;
    const avg24 = valid.reduce((a, b) => a + b.h24, 0) / valid.length;
    const advisoryActive = avg48 >= RAIN_THRESHOLD_INCHES_48H;

    const { error: insertError } = await db.from("rain_events").insert({
      station_id: NOAA_STATIONS.join(","),
      recorded_at: now.toISOString(),
      precipitation_inches_48h: avg48,
      precipitation_inches_24h: avg24,
      advisory_active: advisoryActive,
    });
    if (insertError) throw new Error(`rain_events insert failed: ${insertError.message}`);

    const summary = {
      stations_queried: NOAA_STATIONS.length,
      stations_ok: valid.length,
      stations_failed: NOAA_STATIONS.length - valid.length,
      precipitation_inches_48h: avg48,
      precipitation_inches_24h: avg24,
      advisory_active: advisoryActive,
      errors,
    };

    await finishRun(errors.length > 0 ? "ok_with_errors" : "ok", 1, summary);

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (fatal) {
    await finishRun("failed", 0, { fatal: String(fatal) }, fatal);
    return new Response(
      JSON.stringify({ status: "failed", error: String(fatal), errors }, null, 2),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
