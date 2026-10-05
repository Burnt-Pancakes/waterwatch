/**
 * USGS Instantaneous Values (IV) adapter for stream-stage data.
 *
 * Fetches gage height (parameter 00065) and discharge (parameter 00060)
 * for all gauges registered in the `river_gauges` table and upserts
 * the readings into `gauge_readings`.
 *
 * Unlike water-quality adapters this one writes directly to a separate
 * table (`gauge_readings`) instead of returning AdapterReadings, because
 * the data shape is fundamentally different (continuous stage readings
 * vs discrete bacteria samples). It returns an empty AdapterReading[]
 * to satisfy the DataSourceAdapter contract.
 *
 * Docs: https://waterservices.usgs.gov/nwis/iv/
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdapterReading, AdapterSite, DataSourceAdapter } from "./base";

const USGS_IV_BASE = "https://waterservices.usgs.gov/nwis/iv/";

/** Parameter codes for the USGS IV service. */
export const PARAM_GAGE_HEIGHT = "00065";
export const PARAM_DISCHARGE = "00060";

/** Shape of a USGS IV JSON response (subset of fields we use). */
type UsgsIvResponse = {
  value: {
    timeSeries: Array<{
      variable: { variableCode: Array<{ value: string }> };
      values: Array<{ value: Array<{ value: string; dateTime: string }> }>;
    }>;
  };
};

/** One gauge row from the river_gauges table. */
type GaugeRow = {
  id: string;
  usgs_site_number: string;
};

/**
 * Parse a USGS IV JSON response into a map of parameter code →
 * array of { dateTime, value } entries.
 *
 * @param payload - Raw JSON from the USGS IV endpoint.
 * @returns Map keyed by parameter code (e.g. "00065").
 */
export function parseUsgsIvResponse(
  payload: unknown,
): Map<string, Array<{ dateTime: string; value: string }>> {
  const result = new Map<string, Array<{ dateTime: string; value: string }>>();
  if (!payload || typeof payload !== "object") return result;

  const response = payload as UsgsIvResponse;
  const series = response?.value?.timeSeries;
  if (!Array.isArray(series)) return result;

  for (const ts of series) {
    const paramCode = ts?.variable?.variableCode?.[0]?.value;
    if (!paramCode) continue;
    const readings = ts?.values?.[0]?.value;
    if (!Array.isArray(readings)) continue;
    result.set(paramCode, readings);
  }

  return result;
}

/**
 * Build a USGS IV query URL for the given site number and parameter codes.
 *
 * @param siteNumber - USGS station number (e.g. "01652500").
 * @param period - ISO 8601 duration string (e.g. "P2D" for 2 days).
 */
export function buildUsgsIvUrl(siteNumber: string, period = "P2D"): string {
  const params = new URLSearchParams({
    format: "json",
    sites: siteNumber,
    parameterCd: `${PARAM_GAGE_HEIGHT},${PARAM_DISCHARGE}`,
    period,
  });
  return `${USGS_IV_BASE}?${params.toString()}`;
}

export class UsgsGaugeAdapter implements DataSourceAdapter {
  sourceId = "usgs_gauge";
  displayName = "USGS Stream Gauges (IV)";

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly fetchImpl: (url: string) => Promise<unknown> = async (url) => {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`USGS IV ${res.status} ${res.statusText} for ${url}`);
      return res.json();
    },
  ) {}

  /**
   * No site discovery needed — gauges are seeded via the SQL migration.
   * Returns empty array to satisfy the DataSourceAdapter contract.
   */
  async fetchSites(): Promise<AdapterSite[]> {
    return [];
  }

  /**
   * Fetch gauge readings for all registered river gauges and upsert them
   * into the `gauge_readings` table.
   *
   * Returns an empty array because this adapter writes to a different table
   * than the standard readings pipeline.
   */
  async fetchReadings(_siteId: string, _since: Date): Promise<AdapterReading[]> {
    // Load all gauge rows from the database.
    const { data: gauges, error } = await this.supabase
      .from("river_gauges")
      .select("id, usgs_site_number");
    if (error) throw new Error(`UsgsGaugeAdapter: failed to load gauges: ${error.message}`);
    if (!gauges || gauges.length === 0) return [];

    // Fetch and upsert readings for each gauge concurrently.
    await Promise.all((gauges as GaugeRow[]).map((gauge) => this.ingestGauge(gauge)));

    return [];
  }

  /**
   * Fetch USGS IV data for a single gauge and upsert into gauge_readings.
   *
   * @param gauge - Row from the river_gauges table.
   */
  private async ingestGauge(gauge: GaugeRow): Promise<void> {
    const url = buildUsgsIvUrl(gauge.usgs_site_number);
    let payload: unknown;
    try {
      payload = await this.fetchImpl(url);
    } catch (err) {
      console.warn(`[UsgsGaugeAdapter] fetch failed for ${gauge.usgs_site_number}:`, err);
      return;
    }

    const paramMap = parseUsgsIvResponse(payload);
    const heightSeries = paramMap.get(PARAM_GAGE_HEIGHT) ?? [];
    const dischargeSeries = paramMap.get(PARAM_DISCHARGE) ?? [];

    // Build a combined map keyed by timestamp so we can pair height + discharge.
    const combined = new Map<string, { height: number | null; discharge: number | null }>();

    for (const entry of heightSeries) {
      const v = parseFloat(entry.value);
      combined.set(entry.dateTime, {
        height: Number.isFinite(v) ? v : null,
        discharge: null,
      });
    }
    for (const entry of dischargeSeries) {
      const v = parseFloat(entry.value);
      const existing = combined.get(entry.dateTime);
      if (existing) {
        existing.discharge = Number.isFinite(v) ? v : null;
      } else {
        combined.set(entry.dateTime, { height: null, discharge: Number.isFinite(v) ? v : null });
      }
    }

    if (combined.size === 0) return;

    const rows = Array.from(combined.entries()).map(([dateTime, vals]) => ({
      gauge_id: gauge.id,
      recorded_at: dateTime,
      gage_height_ft: vals.height,
      discharge_cfs: vals.discharge,
      data_source: "usgs_iv",
    }));

    const { error: upsertError } = await this.supabase
      .from("gauge_readings")
      .upsert(rows, { onConflict: "gauge_id,recorded_at", ignoreDuplicates: false });

    if (upsertError) {
      console.warn(`[UsgsGaugeAdapter] upsert failed for ${gauge.usgs_site_number}:`, upsertError);
    }
  }

  /**
   * Satisfies the DataSourceAdapter contract but is not used by this adapter
   * since we parse directly to gauge_readings rows, not AdapterReadings.
   */
  normalize(_raw: unknown): AdapterReading {
    // This adapter writes gauge readings directly — not via the standard pipeline.
    throw new Error("UsgsGaugeAdapter.normalize() is not used by this adapter");
  }
}
