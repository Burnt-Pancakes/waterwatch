/**
 * USGS Water Quality Portal (WQP) adapter.
 *
 * Pulls E. coli and Enterococcus results for the Potomac basin
 * (HUC 02070010) which covers the DC Metro area. The WQP returns
 * JSON in its "Result" endpoint that is row-per-measurement; we
 * normalize each measurement into a {@link AdapterReading}.
 *
 * Docs: https://www.waterqualitydata.us/webservices_documentation/
 */

import type { AdapterReading, AdapterSite, DataSourceAdapter } from "./base";

const WQP_BASE = "https://www.waterqualitydata.us/data/Result/search";
/** Potomac basin HUC-8 — covers the DMV area. */
export const POTOMAC_HUC = "02070010";

/** Subset of WQP fields we care about; other fields are kept in rawPayload. */
type WqpResult = {
  MonitoringLocationIdentifier?: string;
  ActivityStartDate?: string;
  ActivityStartTime?: { Time?: string; TimeZoneCode?: string };
  CharacteristicName?: string;
  ResultMeasureValue?: string | number;
  ResultSampleFractionText?: string;
  ActivityMediaSubdivisionName?: string;
  ResultAnalyticalMethod?: { MethodName?: string };
};

/**
 * Combine WQP's separate date + time fields into a single ISO string.
 *
 * WQP returns local civil time + a tz code (e.g. `EST`). When the time
 * is missing we fall back to midnight UTC on the given date, which is
 * good enough for daily-aggregated readings and never invents precision.
 */
export function combineWqpDateTime(
  date: string | undefined,
  time?: { Time?: string; TimeZoneCode?: string },
): string {
  if (!date) return new Date(0).toISOString();
  const t = time?.Time ?? "00:00:00";
  // We intentionally treat the timestamp as UTC; the WQP rarely supplies
  // sub-day precision and mis-tagging by 4-5h is acceptable for trend display.
  const iso = `${date}T${t}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date(date).toISOString() : d.toISOString();
}

/** Parse `ResultMeasureValue` to a finite number, or null when not numeric. */
export function parseWqpValue(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Fetch helper that throws on non-2xx so the orchestrator records the error. */
async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`USGS WQP ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
}

export class UsgsWqpAdapter implements DataSourceAdapter {
  sourceId = "usgs_wqp";
  displayName = "USGS Water Quality Portal";

  /** Caller-injectable fetch lets tests mock the network without globals. */
  constructor(private readonly fetchImpl: (url: string) => Promise<unknown> = fetchJson) {}

  /**
   * The WQP exposes site metadata via a separate endpoint; we don't use
   * it for ingestion because sites are seeded from OSM + manual data.
   * Returning [] keeps the contract simple and avoids spurious upserts.
   */
  async fetchSites(): Promise<AdapterSite[]> {
    return [];
  }

  /**
   * Build a WQP query for the requested characteristic + date range.
   * `since` becomes the lower bound; the upper bound is "now".
   */
  private buildUrl(characteristic: string, since: Date): string {
    const startDate = since.toISOString().slice(0, 10); // YYYY-MM-DD
    const params = new URLSearchParams({
      huc: POTOMAC_HUC,
      characteristicName: characteristic,
      startDateLo: startDate,
      mimeType: "json",
      // `dataProfile=resultPhysChem` returns only physical/chemical results
      // which is the column shape `normalize` expects.
      dataProfile: "resultPhysChem",
    });
    return `${WQP_BASE}?${params.toString()}`;
  }

  /**
   * Fetch readings for the entire Potomac basin since the given cutoff.
   *
   * NOTE: WQP does not let us scope by `siteId` cheaply because our
   * `siteId` is our own DB id, not their monitoring-location id. We
   * therefore fetch the basin once per characteristic and let the
   * orchestrator filter by `externalSiteId` when joining to our sites.
   */
  async fetchReadings(_siteId: string, since: Date): Promise<AdapterReading[]> {
    const [ecoli, entero] = await Promise.all([
      this.fetchImpl(this.buildUrl("E. coli", since)),
      this.fetchImpl(this.buildUrl("Enterococcus", since)),
    ]);

    // The WQP JSON shape wraps rows under `.results` in newer profiles,
    // and was a bare array historically — handle both.
    const flatten = (payload: unknown): WqpResult[] => {
      if (Array.isArray(payload)) return payload as WqpResult[];
      if (payload && typeof payload === "object" && "results" in payload) {
        const r = (payload as { results: unknown }).results;
        return Array.isArray(r) ? (r as WqpResult[]) : [];
      }
      return [];
    };

    return [...flatten(ecoli), ...flatten(entero)].map((row) => this.normalize(row));
  }

  /**
   * Convert one WQP result row into our normalized shape.
   *
   * `CharacteristicName` decides whether the value lands in
   * `eColiMpn` (freshwater indicator) or `enterococciCce`
   * (marine/tidal indicator). Unknown characteristics yield nulls,
   * which the orchestrator can then skip.
   */
  normalize(raw: unknown): AdapterReading {
    const r = (raw ?? {}) as WqpResult;
    const value = parseWqpValue(r.ResultMeasureValue);
    const isEcoli = (r.CharacteristicName ?? "").toLowerCase().includes("e. coli");
    const isEntero = (r.CharacteristicName ?? "").toLowerCase().includes("enterococc");
    return {
      externalSiteId: r.MonitoringLocationIdentifier ?? "",
      sampledAt: combineWqpDateTime(r.ActivityStartDate, r.ActivityStartTime),
      eColiMpn: isEcoli ? value : null,
      enterococciCce: isEntero ? value : null,
      sampleMethod: r.ResultAnalyticalMethod?.MethodName ?? null,
      sourceUrl: `${WQP_BASE}?siteid=${encodeURIComponent(r.MonitoringLocationIdentifier ?? "")}`,
      rawPayload: raw,
    };
  }
}
