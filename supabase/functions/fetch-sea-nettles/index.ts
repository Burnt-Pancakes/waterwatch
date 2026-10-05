/**
 * fetch-sea-nettles — CBIBS sea nettle probability forecast.
 *
 * v1, CBIBS-only. Pulls the latest `seanettle_prob` reading for every active
 * CBIBS (Chesapeake Bay Interpretive Buoy System) station that reports it,
 * plus water temperature and salinity from the same station where available,
 * and upserts one row per (station_code, observed_at) into
 * nettle_observations.
 *
 * Additive: does not touch waterQualityEngine.ts, bacteria classification,
 * site status, or any table other than nettle_observations and ingest_runs.
 *
 * Variable name confirmed against NOAA's public CBIBS API documentation
 * (buoybay.noaa.gov/data/api, WaterQuality parameter group): `seanettle_prob`.
 * Not confirmed against a live authenticated response - this environment has
 * no CBIBS_API_KEY available, so the exact numeric scale/shape of a real
 * seanettle_prob measurement is inferred from the documented parameter list
 * and from how sea_water_temperature/sea_water_salinity are already shaped
 * in fetch-water-conditions/index.ts, not independently verified. Verify the
 * first real ingest_runs summary after this is deployed.
 *
 * Reuses the CBIBS client pattern from fetch-water-conditions/index.ts:
 *   - `key` is a query param, not a header. A missing/invalid key returns
 *     HTTP 200 with {"error":"Invalid API Key"} - checked from the payload,
 *     not the status.
 *   - CBIBS timestamps arrive as "...+00" (a two-digit UTC offset outside
 *     the ECMAScript date-time format) and need padding to "...+00:00"
 *     before Date.parse.
 *   - variable[].actualName / measurements[0] is "the latest reading for
 *     this station+variable"; a station simply omitting a variable is normal.
 *
 * Deliberately does NOT apply fetch-water-conditions' 6-hour ingest-time
 * staleness filter: the latest reading per station is always stored
 * regardless of its own age, and the map layer (src/modules/seaNettles/)
 * decides what counts as "stale" for display from observed_at. nettle_
 * observations' own 2-day retention cron is the only pruning that happens.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CBIBS_API_KEY = Deno.env.get("CBIBS_API_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CbibsMeasurement {
  time: string;
  value: number | string;
  QA?: string | null;
}

interface CbibsVariable {
  actualName: string;
  measurements?: CbibsMeasurement[];
}

interface CbibsStation {
  stationShortName: string;
  stationLongName?: string | null;
  active: boolean;
  opState?: string | null;
  latitude: number;
  longitude: number;
  variable: CbibsVariable[];
}

interface CbibsResponse {
  stations?: CbibsStation[];
  error?: string;
}

interface NettleRow {
  station_code: string;
  station_name: string | null;
  lat: number;
  lng: number;
  observed_at: string;
  probability: number;
  water_temp_c: number | null;
  salinity_psu: number | null;
  source: string;
}

/** CBIBS timestamps arrive as "...+00" - pad to a valid ISO offset before parsing. */
function parseCbibsTime(raw: string): number {
  const iso = raw.replace(/([+-]\d{2})$/, "$1:00");
  return Date.parse(iso);
}

function latestMeasurement(station: CbibsStation, actualName: string): CbibsMeasurement | null {
  const v = station.variable.find((x) => x.actualName === actualName);
  return v?.measurements?.[0] ?? null;
}

function numericValue(m: CbibsMeasurement | null): number | null {
  if (!m) return null;
  const n = typeof m.value === "number" ? m.value : parseFloat(String(m.value));
  return Number.isFinite(n) ? n : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth matches fetch-rainfall: Authorization: Bearer <service key> for the
  // gateway, or x-cron-secret for the pg_cron dispatch's own check.
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

  // Source of truth for "did this ingest actually finish" - matches
  // fetch-rainfall's finishRun shape exactly.
  const finishRun = async (
    status: "ok" | "ok_with_errors" | "failed",
    rowsUpserted: number,
    summary: unknown,
    fatal?: unknown,
  ) => {
    const { error } = await db.from("ingest_runs").insert({
      run_name: "fetch-sea-nettles",
      function_name: "fetch-sea-nettles",
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

  let stationsTotal = 0;
  let stationsActive = 0;
  let stationsReportingNettleProb = 0;
  let stationsSkippedNoVariable = 0;
  let stationsSkippedNoCoords = 0;
  let stationsFailed = 0;

  try {
    const res = await fetch(
      `https://mw.buoybay.noaa.gov/api/v1/json/station?key=${encodeURIComponent(CBIBS_API_KEY)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) throw new Error(`CBIBS HTTP ${res.status}`);

    const payload = (await res.json()) as CbibsResponse;
    if (payload.error || !Array.isArray(payload.stations)) {
      throw new Error(`CBIBS API error: ${payload.error ?? "unexpected payload"}`);
    }

    stationsTotal = payload.stations.length;
    const activeStations = payload.stations.filter((s) => s.active === true);
    stationsActive = activeStations.length;

    const rows: NettleRow[] = [];

    for (const station of activeStations) {
      // One station's bad data must not abort the run.
      try {
        const nettleM = latestMeasurement(station, "seanettle_prob");
        if (!nettleM) {
          stationsSkippedNoVariable++;
          continue; // Station omits this variable - normal per spec.
        }
        if (station.latitude == null || station.longitude == null) {
          stationsSkippedNoCoords++;
          continue;
        }

        const ts = parseCbibsTime(nettleM.time);
        if (Number.isNaN(ts)) {
          errors.push(`${station.stationShortName}: unparseable timestamp "${nettleM.time}"`);
          stationsFailed++;
          continue;
        }

        const probability = numericValue(nettleM);
        if (probability === null || probability < 0 || probability > 100) {
          errors.push(`${station.stationShortName}: out-of-range probability "${nettleM.value}"`);
          stationsFailed++;
          continue;
        }

        rows.push({
          station_code: station.stationShortName,
          station_name: station.stationLongName ?? null,
          lat: station.latitude,
          lng: station.longitude,
          observed_at: new Date(ts).toISOString(),
          probability,
          water_temp_c: numericValue(latestMeasurement(station, "sea_water_temperature")),
          salinity_psu: numericValue(latestMeasurement(station, "sea_water_salinity")),
          source: "CBIBS",
        });
        stationsReportingNettleProb++;
      } catch (stationErr) {
        stationsFailed++;
        const message = stationErr instanceof Error ? stationErr.message : String(stationErr);
        errors.push(`${station.stationShortName}: ${message}`);
        console.warn(`[fetch-sea-nettles] ${station.stationShortName} failed: ${message}`);
      }
    }

    let rowsUpserted = 0;
    if (rows.length > 0) {
      const { error: upsertError, count } = await db
        .from("nettle_observations")
        .upsert(rows, { onConflict: "station_code,observed_at", count: "exact" });
      if (upsertError) throw new Error(`nettle_observations upsert failed: ${upsertError.message}`);
      rowsUpserted = count ?? rows.length;
    }

    const summary = {
      stations_total: stationsTotal,
      stations_active: stationsActive,
      stations_reporting_nettle_prob: stationsReportingNettleProb,
      stations_skipped_no_variable: stationsSkippedNoVariable,
      stations_skipped_no_coords: stationsSkippedNoCoords,
      stations_failed: stationsFailed,
      rows_upserted: rowsUpserted,
      errors,
    };

    await finishRun(errors.length > 0 ? "ok_with_errors" : "ok", rowsUpserted, summary);

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
