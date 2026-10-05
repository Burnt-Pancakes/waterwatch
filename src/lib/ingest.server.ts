/**
 * Ingestion orchestrator (server-only).
 *
 * Loops over every {@link DataSourceAdapter}, normalizes readings into the
 * `readings` table shape, computes the display status via
 * {@link getWaterStatus}, and upserts on
 * `(site_id, sampled_at, data_source)` so re-runs are idempotent.
 *
 * This file lives under `*.server.ts` so the Vite import-protection layer
 * keeps it out of any client bundle (the orchestrator imports
 * `client.server.ts` and would otherwise leak the service role key).
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getWaterStatus } from "@/lib/waterQualityEngine";
import type { DataSourceAdapter, IngestionResult, AdapterReading } from "./adapters/base";
import { UsgsWqpAdapter } from "./adapters/usgsWqpAdapter";
import { ArlingtonCountyAdapter } from "./adapters/arlingtonCountyAdapter";
import { NoaaRainAdapter } from "./adapters/noaaRainAdapter";
import { OsmPoiAdapter } from "./adapters/osmPoiAdapter";
import { OpenDataDCAdapter } from "./adapters/openDataDCAdapter";
import { MarylandDNRAdapter } from "./adapters/marylandDNRAdapter";
import { VirginiaDWRAdapter } from "./adapters/virginiaDWRAdapter";
import { UsgsGaugeAdapter } from "./adapters/usgsGaugeAdapter";
import type { TablesInsert } from "@/types/database.types";

type WaterBodyType = "freshwater" | "tidal_brackish";

/** Map sourceId → adapter id used for cron/API "sourceId" filter. */
export const ADAPTER_FILTER_IDS = {
  usgs: "usgs_wqp",
  arlington: "arlington_county",
  noaa: "noaa_rain",
  osm: "osm_poi",
  opendatadc: "opendatadc",
  mddnr: "mddnr",
  vadwr: "vadwr",
  usgsgauge: "usgs_gauge",
} as const;

/** Build the default adapter set. Exposed so tests can substitute fakes. */
export function buildDefaultAdapters(): DataSourceAdapter[] {
  return [
    new UsgsWqpAdapter(),
    new ArlingtonCountyAdapter(supabaseAdmin),
    new NoaaRainAdapter(supabaseAdmin),
    new OsmPoiAdapter(supabaseAdmin),
    new OpenDataDCAdapter(supabaseAdmin),
    new MarylandDNRAdapter(supabaseAdmin),
    new VirginiaDWRAdapter(supabaseAdmin),
    new UsgsGaugeAdapter(supabaseAdmin),
  ];
}

/** Lookup helper: site id + water-body type by `osm_id` / external id. */
type SiteIndex = Map<string, { id: string; waterBodyType: WaterBodyType }>;

/**
 * Lookup table from any external site identifier we know about to the
 * internal site row. Currently keyed on `osm_id`; extend as we add more
 * source-specific id columns to `sites`.
 */
async function loadSiteIndex(): Promise<SiteIndex> {
  const { data, error } = await supabaseAdmin
    .from("sites")
    .select("id, osm_id, water_body_type")
    .eq("is_active", true);
  if (error) throw new Error(`loadSiteIndex failed: ${error.message}`);
  const idx: SiteIndex = new Map();
  for (const row of data ?? []) {
    if (!row.osm_id) continue;
    idx.set(row.osm_id as string, {
      id: row.id as string,
      waterBodyType: (row.water_body_type as WaterBodyType) ?? "freshwater",
    });
  }
  return idx;
}

/** Default lookback window per source (USGS uses 90d on cold start, 7d otherwise). */
function defaultSince(): Date {
  return new Date(Date.now() - 7 * 24 * 3600_000);
}

/**
 * Run one adapter and upsert its readings.
 *
 * Returns a tuple of (inserted, skipped) so the caller can aggregate.
 */
export async function persistReadings(
  adapter: DataSourceAdapter,
  readings: AdapterReading[],
  siteIndex: SiteIndex,
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  const rows: TablesInsert<"readings">[] = [];
  for (const r of readings) {
    const site = siteIndex.get(r.externalSiteId);
    if (!site) {
      // Reading from a site we don't track yet — keep raw payload for audit
      // but don't insert; sites are created by OSM adapter / manual seed.
      skipped++;
      continue;
    }
    if (r.eColiMpn === null && r.enterococciCce === null) {
      skipped++;
      continue;
    }
    const statusConfig = getWaterStatus(
      r.eColiMpn,
      r.enterococciCce,
      site.waterBodyType,
      r.sampledAt,
    );
    rows.push({
      site_id: site.id,
      sampled_at: r.sampledAt,
      e_coli_mpn: r.eColiMpn,
      enterococci_cce: r.enterococciCce,
      sample_method: r.sampleMethod,
      data_source: adapter.sourceId,
      source_url: r.sourceUrl,
      status: statusConfig.status,
      raw_payload: r.rawPayload as never,
    });
  }
  if (rows.length > 0) {
    const { error } = await supabaseAdmin
      .from("readings")
      .upsert(rows, { onConflict: "site_id,sampled_at,data_source", ignoreDuplicates: false });
    if (error) throw new Error(`upsert readings failed: ${error.message}`);
    inserted = rows.length;
  }
  return { inserted, skipped };
}

/**
 * Top-level orchestrator. Pass a `sourceId` (e.g. `"noaa_rain"`) to run
 * a single adapter; omit it to run all configured adapters.
 */
export async function runIngestion(
  sourceId?: string,
  overrideAdapters?: DataSourceAdapter[],
): Promise<IngestionResult> {
  const adapters = (overrideAdapters ?? buildDefaultAdapters()).filter(
    (a) => !sourceId || a.sourceId === sourceId,
  );
  const result: IngestionResult = {
    sourcesRun: [],
    readingsInserted: 0,
    readingsSkipped: 0,
    errors: [],
  };
  const siteIndex = await loadSiteIndex();
  const since = defaultSince();

  for (const adapter of adapters) {
    result.sourcesRun.push(adapter.sourceId);
    try {
      // fetchSites is idempotent and only the OSM adapter actually upserts;
      // calling it on every adapter keeps the contract uniform.
      await adapter.fetchSites();
      const readings = await adapter.fetchReadings("*", since);
      const { inserted, skipped } = await persistReadings(adapter, readings, siteIndex);
      result.readingsInserted += inserted;
      result.readingsSkipped += skipped;
    } catch (err) {
      result.errors.push({ source: adapter.sourceId, message: (err as Error).message });
    }
  }
  return result;
}
