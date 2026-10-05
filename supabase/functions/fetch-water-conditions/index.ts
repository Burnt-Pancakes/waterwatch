/**
 * fetch-water-conditions — ingests water temperature from two sources into
 * water_temp_observations.
 *
 * USGS:  /ogcapi/v0/collections/latest-continuous, parameter_code=00010.
 *        One call; bbox covers the full DC/MD/VA footprint.
 * CBIBS: mw.buoybay.noaa.gov/api/v1/json/station — Bay buoy network.
 *        CBIBS failure is non-fatal; function succeeds on USGS alone.
 *
 * air_temperature from CBIBS is not ingested this pass (Phase 5.2).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const USGS_API_KEY = Deno.env.get("USGS_API_KEY") ?? "";
const CBIBS_API_KEY = Deno.env.get("CBIBS_API_KEY") ?? "";

// latest-continuous returns the latest value IN A TIME SERIES, not a recent
// value. USGS-384637075153201 has qualifier=null, approval_status="Approved",
// and a timestamp from 2020 — every non-temporal filter passes it. This guard
// is mandatory, not defensive.
const MAX_READING_AGE_HOURS = 6;

const BBOX = "-79.5,37.0,-75.0,39.8";
const TEMP_MIN_C = -5;
const TEMP_MAX_C = 45;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Site-type allowlist (condition 4 of the USGS filter chain)
// ---------------------------------------------------------------------------
// Match ST by prefix so ST-TS, ST-CA, and any future USGS subtypes are
// included automatically. An exact-match list silently drops stations when
// USGS adds a subtype (same failure mode as the agencyFromOrg() substring bug).

function isSurfaceWater(code: string): boolean {
  return code.startsWith("ST") || code === "ES" || code === "LK";
}

type StaleAgeBucket =
  | "under_24h"
  | "1_to_7_days"
  | "7_to_90_days"
  | "90_days_to_1_year"
  | "over_1_year";

function bucketStaleAge(ageMs: number): StaleAgeBucket {
  const hours = ageMs / 3_600_000;
  if (hours <= 24) return "under_24h";
  const days = hours / 24;
  if (days <= 7) return "1_to_7_days";
  if (days <= 90) return "7_to_90_days";
  if (days <= 365) return "90_days_to_1_year";
  return "over_1_year";
}

// ---------------------------------------------------------------------------
// USGS OGC API types
// ---------------------------------------------------------------------------

interface UsgsFeature {
  geometry: { type: string; coordinates: [number, number] }; // [lng, lat]
  properties: {
    time_series_id: string;
    monitoring_location_id: string;
    statistic_id: string;
    time: string;
    value: string | null;
    unit_of_measure: string;
    approval_status: string;
    qualifier: string[] | null;
  };
}

interface UsgsMonLocFeature {
  properties: {
    // The monitoring-locations collection exposes the station identifier as
    // `id` (e.g. "USGS-01646500") — there is NO `monitoring_location_id`
    // property. Keying on the wrong field makes every latest-continuous
    // station "unresolved" and silently zeroes the ingest.
    id: string;
    monitoring_location_name: string | null;
    site_type_code: string | null;
  };
}

// ---------------------------------------------------------------------------
// CBIBS API types
// ---------------------------------------------------------------------------

interface CbibsMeasurement {
  time: string;
  value: number;
  QA: string;
}

interface CbibsVariable {
  // The machine name is `actualName` (e.g. "sea_water_temperature");
  // `reportName` is the display label ("Water Temperature"). There is no
  // `name` field — matching on it finds nothing and silently ingests zero rows.
  actualName: string;
  reportName?: string;
  measurements?: CbibsMeasurement[];
}

interface CbibsStation {
  // Station identity fields are stationShortName ("BH") / stationLongName
  // ("Baltimore Harbor") — not id/name.
  stationShortName: string;
  stationLongName: string;
  active: boolean;
  opState?: string;
  latitude: number; // top-level station coordinates — DO NOT use variable[].latitude
  longitude: number;
  variable: CbibsVariable[];
}

interface CbibsResponse {
  stations: CbibsStation[];
}

// ---------------------------------------------------------------------------
// Upsert row shape
// ---------------------------------------------------------------------------

interface TempObsRow {
  source: string;
  station_code: string;
  station_name: string | null;
  time_series_id: string | null;
  lat: number;
  lng: number;
  observed_at: string;
  depth_m: null; // neither source reports usable depth; surface assumed
  temp_c: number;
  qa: string | null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const errors: string[] = [];
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const staleCutoff = Date.now() - MAX_READING_AGE_HOURS * 3_600_000;
  const startedAt = new Date().toISOString();

  // Source of truth for "did this ingest actually finish": written at the end
  // of both the success and failure paths. cron.job_run_details and
  // net._http_response only observe the dispatch, never the work.
  const finishRun = async (
    status: "ok" | "ok_with_errors" | "failed",
    rowsUpserted: number,
    summary: unknown,
    fatal?: unknown,
  ) => {
    const { error } = await db.from("ingest_runs").insert({
      run_name: "fetch-water-conditions",
      function_name: "fetch-water-conditions",
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
    // ── 1. Fetch monitoring-locations for site-type allowlist ─────────────────
    // site_type_code is not available on latest-continuous; one separate call
    // caches it for the lifetime of this invocation.

    const stationInfoMap = new Map<string, { siteTypeCode: string | null; name: string | null }>();

    const usgsHeaders: Record<string, string> = { Accept: "application/json" };
    if (USGS_API_KEY) usgsHeaders["X-Api-Key"] = USGS_API_KEY;

    // Server-side site_type_code filters keep each request under the 10,000-row
    // page cap (an unfiltered bbox fetch is truncated at exactly 10,000, which
    // silently drops stations). ST-TS (tidal streams) and ST-CA (canals) are
    // subtypes of ST and pass isSurfaceWater() but require explicit separate
    // requests because the API treats them as distinct exact-match values.
    for (const typeCode of ["ST", "ST-TS", "ST-CA", "ES", "LK"]) {
      try {
        const mlUrl =
          `https://api.waterdata.usgs.gov/ogcapi/v0/collections/monitoring-locations/items` +
          `?f=json&limit=10000&bbox=${BBOX}&site_type_code=${typeCode}`;
        const mlRes = await fetch(mlUrl, { headers: usgsHeaders });
        if (!mlRes.ok) {
          errors.push(`monitoring-locations (${typeCode}) HTTP ${mlRes.status}`);
          continue;
        }
        const mlPayload = (await mlRes.json()) as { features: UsgsMonLocFeature[] };
        for (const f of mlPayload.features ?? []) {
          stationInfoMap.set(f.properties.id, {
            siteTypeCode: f.properties.site_type_code ?? null,
            name: f.properties.monitoring_location_name ?? null,
          });
        }
      } catch (err) {
        errors.push(
          `monitoring-locations (${typeCode}) fetch error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // ── 2. Fetch latest-continuous (water temperature) ────────────────────────

    const lcUrl =
      `https://api.waterdata.usgs.gov/ogcapi/v0/collections/latest-continuous/items` +
      `?f=json&limit=1000&parameter_code=00010&bbox=${BBOX}`;

    let usgsRaw: UsgsFeature[] = [];

    try {
      const lcRes = await fetch(lcUrl, { headers: usgsHeaders });
      if (!lcRes.ok) {
        errors.push(`latest-continuous HTTP ${lcRes.status}`);
      } else {
        const payload = (await lcRes.json()) as { features: UsgsFeature[] };
        usgsRaw = payload.features ?? [];
      }
    } catch (err) {
      errors.push(
        `latest-continuous fetch error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const usgsReturned = usgsRaw.length;

    // Diagnostics collected before filtering so they reflect the full API response.
    const statisticIdsSeen = [...new Set(usgsRaw.map((f) => f.properties.statistic_id))].sort();
    const qualifiersSeen = [
      ...new Set(usgsRaw.flatMap((f) => f.properties.qualifier ?? [])),
    ].sort();

    // ── 3. Filter USGS ────────────────────────────────────────────────────────

    let skippedNull = 0;
    let skippedDiscontinued = 0;
    let skippedStale = 0;
    let skippedNonSurface = 0;
    let skippedUnresolvedType = 0;

    const staleAgeBuckets = {
      under_24h: 0,
      "1_to_7_days": 0,
      "7_to_90_days": 0,
      "90_days_to_1_year": 0,
      over_1_year: 0,
    };

    const nonSurfaceLog: string[] = [];
    const unresolvedLog: string[] = [];
    const usgsFiltered: UsgsFeature[] = [];

    for (const f of usgsRaw) {
      const p = f.properties;

      // Condition 1: null value
      if (p.value === null || p.value === undefined) {
        skippedNull++;
        continue;
      }

      // Condition 2: DISCONTINUED in qualifier array
      if ((p.qualifier ?? []).includes("DISCONTINUED")) {
        skippedDiscontinued++;
        continue;
      }

      // Condition 3: staleness — mandatory; latest-continuous is not a recency
      // guarantee, it is the most-recent value in the series regardless of age.
      const ts = Date.parse(p.time);
      if (Number.isNaN(ts) || ts <= staleCutoff) {
        skippedStale++;
        if (!Number.isNaN(ts)) {
          staleAgeBuckets[bucketStaleAge(Date.now() - ts)]++;
        }
        continue;
      }

      // Condition 4: site type must be resolvable and in the surface-water set
      const id = p.monitoring_location_id;
      const info = stationInfoMap.get(id);

      if (info === undefined) {
        // Station absent from monitoring-locations response — unresolvable
        skippedUnresolvedType++;
        unresolvedLog.push(id);
        continue;
      }

      if (info.siteTypeCode === null) {
        // Present in monitoring-locations but site type is null — unresolvable
        skippedUnresolvedType++;
        unresolvedLog.push(`${id}(null)`);
        continue;
      }

      if (!isSurfaceWater(info.siteTypeCode)) {
        // GW, FA-*, OC, or any other non-surface type
        skippedNonSurface++;
        nonSurfaceLog.push(`${id}(${info.siteTypeCode})`);
        continue;
      }

      usgsFiltered.push(f);
    }

    if (nonSurfaceLog.length > 0) console.log("Skipped non-surface:", nonSurfaceLog.join(", "));
    if (unresolvedLog.length > 0) console.log("Skipped unresolved type:", unresolvedLog.join(", "));

    // ── 4. Deduplicate: multiple time series per station ──────────────────────
    // After the staleness filter most duplicates resolve themselves. For any
    // that remain: most-recent time wins; tie-break on time_series_id ascending
    // so the choice is deterministic across runs (not response-order dependent).

    const byStation = new Map<string, UsgsFeature>();

    for (const f of usgsFiltered) {
      const id = f.properties.monitoring_location_id;
      const existing = byStation.get(id);
      if (!existing) {
        byStation.set(id, f);
        continue;
      }
      const existingTs = Date.parse(existing.properties.time);
      const candidateTs = Date.parse(f.properties.time);
      if (
        candidateTs > existingTs ||
        (candidateTs === existingTs &&
          f.properties.time_series_id < existing.properties.time_series_id)
      ) {
        byStation.set(id, f);
      }
    }

    // ── 5. Build USGS rows ────────────────────────────────────────────────────

    const usgsRows: TempObsRow[] = [];
    let oldestTs = Infinity;
    let newestTs = -Infinity;

    for (const f of byStation.values()) {
      const p = f.properties;

      if (p.unit_of_measure !== "degC") {
        errors.push(`Unexpected unit at ${p.monitoring_location_id}: "${p.unit_of_measure}"`);
        continue;
      }

      const temp = parseFloat(p.value!);
      if (Number.isNaN(temp)) {
        errors.push(`NaN value at ${p.monitoring_location_id}: raw="${p.value}"`);
        continue;
      }
      if (temp < TEMP_MIN_C || temp > TEMP_MAX_C) {
        errors.push(`Out-of-range temp at ${p.monitoring_location_id}: ${temp}°C`);
        continue;
      }

      // geometry.coordinates is GeoJSON [lng, lat] — do not swap.
      const [lng, lat] = f.geometry.coordinates;
      const ts = Date.parse(p.time);

      oldestTs = Math.min(oldestTs, ts);
      newestTs = Math.max(newestTs, ts);

      usgsRows.push({
        source: "usgs",
        station_code: p.monitoring_location_id,
        station_name: stationInfoMap.get(p.monitoring_location_id)?.name ?? null,
        time_series_id: p.time_series_id,
        lat,
        lng,
        observed_at: new Date(ts).toISOString(),
        depth_m: null,
        temp_c: temp,
        qa: p.approval_status,
      });
    }

    // ── 6. CBIBS ─────────────────────────────────────────────────────────────

    const cbibsRows: TempObsRow[] = [];
    const cbibsQaValues = new Set<string>();
    let cbibsStationsActive = 0;
    let cbibsSkipped = false;
    let cbibsSkippedStale = 0;

    try {
      // CBIBS authenticates via a `key` QUERY PARAM, not a header. Without it the
      // API still returns HTTP 200 with body {"error":"Invalid API Key"} — so a
      // missing/invalid key must be detected from the payload, not the status.
      const cbibsHeaders: Record<string, string> = { Accept: "application/json" };

      const cbibsRes = await fetch(
        `https://mw.buoybay.noaa.gov/api/v1/json/station?key=${encodeURIComponent(CBIBS_API_KEY)}`,
        { headers: cbibsHeaders },
      );

      if (!cbibsRes.ok) {
        errors.push(`CBIBS HTTP ${cbibsRes.status} — proceeding on USGS alone`);
        cbibsSkipped = true;
      } else {
        const payload = (await cbibsRes.json()) as CbibsResponse & { error?: string };
        if (payload.error || !Array.isArray(payload.stations)) {
          errors.push(
            `CBIBS API error: ${payload.error ?? "unexpected payload"} — proceeding on USGS alone`,
          );
          cbibsSkipped = true;
        }
        const activeStations = (payload.stations ?? []).filter((s) => s.active === true);
        cbibsStationsActive = activeStations.length;

        for (const station of activeStations) {
          // Log both liveness fields — documentation does not specify which wins.
          console.log(
            `CBIBS ${station.stationShortName} active=${station.active} opState=${station.opState ?? "(none)"}`,
          );

          const tempVar = station.variable.find((v) => v.actualName === "sea_water_temperature");
          if (!tempVar) continue; // Station omits this variable — normal per spec.

          const m = tempVar.measurements?.[0];
          if (!m) continue;

          // CBIBS timestamps arrive as "2026-08-26T19:24:00+00" — a two-digit UTC
          // offset that is outside the ECMAScript date-time format. Normalise before
          // parsing; an Invalid Date becomes a NOT NULL violation on observed_at or,
          // worse, a wrong timestamp that makes a stale reading look current.
          const iso = m.time.replace(/([+-]\d{2})$/, "$1:00");
          const ts = Date.parse(iso);
          if (Number.isNaN(ts)) {
            errors.push(`CBIBS ${station.stationShortName}: unparseable timestamp "${m.time}"`);
            continue;
          }

          if (ts <= staleCutoff) {
            cbibsSkippedStale++;
            staleAgeBuckets[bucketStaleAge(Date.now() - ts)]++;
            continue;
          }

          const temp = typeof m.value === "number" ? m.value : parseFloat(String(m.value));
          if (Number.isNaN(temp)) {
            errors.push(`CBIBS ${station.stationShortName}: NaN value "${m.value}"`);
            continue;
          }
          if (temp < TEMP_MIN_C || temp > TEMP_MAX_C) {
            errors.push(`CBIBS ${station.stationShortName}: out-of-range temp ${temp}°C`);
            continue;
          }

          // QA is "unknown" network-wide as of Aug 2026. Store verbatim so that
          // if NOAA starts populating the field, we capture the real values rather
          // than masking them behind a hardcoded check.
          if (m.QA != null) cbibsQaValues.add(m.QA);

          oldestTs = Math.min(oldestTs, ts);
          newestTs = Math.max(newestTs, ts);

          cbibsRows.push({
            source: "cbibs",
            station_code: station.stationShortName,
            station_name: station.stationLongName ?? null,
            time_series_id: null,
            // Top-level station coordinates. variable[] also carries latitude/longitude
            // entries — those are ignored; a station omitting them would cause a NOT
            // NULL failure on insert.
            lat: station.latitude,
            lng: station.longitude,
            observed_at: new Date(ts).toISOString(),
            depth_m: null, // elevation field reads 0.0 for both water and air temp —
            //               it is an unfilled placeholder, not a depth measurement.
            temp_c: temp,
            qa: m.QA ?? null,
          });

          // air_temperature is available per station but is not ingested this pass.
          // See Phase 5.2 for the target air-temp store.
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`CBIBS error: ${msg} — proceeding on USGS alone`);
      cbibsSkipped = true;
    }

    // ── 7. Upsert ────────────────────────────────────────────────────────────

    const allRows = [...usgsRows, ...cbibsRows];
    let usgsUpserted = 0;
    let cbibsTempUpserted = 0;

    if (allRows.length > 0) {
      // Chunk to stay within Supabase payload limits.
      const CHUNK = 500;
      for (let i = 0; i < allRows.length; i += CHUNK) {
        const chunk = allRows.slice(i, i + CHUNK);
        const { error: upsertErr } = await db
          .from("water_temp_observations")
          .upsert(chunk, { onConflict: "source,station_code,observed_at" });
        if (upsertErr) {
          errors.push(`upsert batch ${Math.floor(i / CHUNK)}: ${upsertErr.message}`);
        } else {
          usgsUpserted += chunk.filter((r) => r.source === "usgs").length;
          cbibsTempUpserted += chunk.filter((r) => r.source === "cbibs").length;
        }
      }
    }

    // ── 8. Summary ───────────────────────────────────────────────────────────
    // oldest_observed_at is the operational tripwire: if it drifts backward the
    // staleness filter changed or the upstream feed is serving historical data.

    const summary = {
      usgs_returned: usgsReturned,
      usgs_upserted: usgsUpserted,
      statistic_ids_seen: statisticIdsSeen,
      qualifiers_seen: qualifiersSeen,
      skipped_stale: skippedStale + cbibsSkippedStale,
      skipped_stale_age_buckets: staleAgeBuckets,
      skipped_discontinued: skippedDiscontinued,
      skipped_non_surface: skippedNonSurface,
      skipped_unresolved_type: skippedUnresolvedType,
      skipped_null: skippedNull,
      oldest_observed_at: oldestTs < Infinity ? new Date(oldestTs).toISOString() : null,
      newest_observed_at: newestTs > -Infinity ? new Date(newestTs).toISOString() : null,
      cbibs_stations_active: cbibsStationsActive,
      cbibs_temp_upserted: cbibsTempUpserted,
      cbibs_qa_values_seen: [...cbibsQaValues].sort(),
      cbibs_skipped: cbibsSkipped,
      errors,
    };

    await finishRun(
      errors.length > 0 ? "ok_with_errors" : "ok",
      usgsUpserted + cbibsTempUpserted,
      summary,
    );

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
