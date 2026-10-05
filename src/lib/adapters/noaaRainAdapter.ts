/**
 * NOAA / National Weather Service rainfall adapter.
 *
 * Pulls 48h precipitation totals from three reference stations covering
 * the DMV (DCA, BWI, Dulles), averages them, and writes a row to the
 * `rain_events` table. The orchestrator flips the rain advisory on at
 * the {@link RAIN_THRESHOLD_INCHES_48H} threshold (default 1.0 inches).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdapterReading, AdapterSite, DataSourceAdapter } from "./base";
import { RAIN_THRESHOLD_INCHES_48H } from "@/lib/waterQualityEngine";

const NWS_BASE = "https://api.weather.gov";
export const NOAA_STATIONS = ["KDCA", "KBWI", "KDULLES"] as const;

/** Subset of the NWS observation shape we depend on. */
type NwsObservation = {
  properties?: {
    timestamp?: string;
    precipitationLast6Hours?: { value: number | null; unitCode?: string };
  };
};

type NwsObservationCollection = {
  features?: NwsObservation[];
};

/** Convert NWS metric values (mm) into inches; passes unknown units through. */
export function metricToInches(value: number, unitCode: string | undefined): number {
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
export function sumLast48h(collection: NwsObservationCollection, now: Date): number {
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
export function sumLast24h(collection: NwsObservationCollection, now: Date): number {
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

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/geo+json" } });
  if (!res.ok) throw new Error(`NWS ${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

export class NoaaRainAdapter implements DataSourceAdapter {
  sourceId = "noaa_rain";
  displayName = "NOAA / NWS Precipitation";

  constructor(
    private readonly supabase: Pick<SupabaseClient, "from">,
    private readonly fetchImpl: (url: string) => Promise<unknown> = fetchJson,
    private readonly nowFn: () => Date = () => new Date(),
  ) {}

  async fetchSites(): Promise<AdapterSite[]> {
    return [];
  }

  /**
   * For each reference station, fetch the last 48h of observations,
   * sum precip, then average across stations. The result is written to
   * `rain_events` and also returned as an empty AdapterReading[] (this
   * adapter doesn't produce bacteria readings).
   */
  async fetchReadings(_siteId: string, _since: Date): Promise<AdapterReading[]> {
    const now = this.nowFn();
    const perStation = await Promise.all(
      NOAA_STATIONS.map(async (station) => {
        const url = `${NWS_BASE}/stations/${station}/observations`;
        try {
          const payload = (await this.fetchImpl(url)) as NwsObservationCollection;
          return { h48: sumLast48h(payload, now), h24: sumLast24h(payload, now) };
        } catch (err) {
          // One station outage shouldn't kill the average — log and skip.
          console.warn(`[noaa_rain] ${station} fetch failed: ${(err as Error).message}`);
          return null;
        }
      }),
    );
    const valid = perStation.filter((v): v is { h48: number; h24: number } => v !== null);
    if (valid.length === 0) {
      throw new Error("NOAA: all reference stations failed");
    }
    const avg = valid.reduce((a, b) => a + b.h48, 0) / valid.length;
    const avg24 = valid.reduce((a, b) => a + b.h24, 0) / valid.length;
    const advisoryActive = avg >= RAIN_THRESHOLD_INCHES_48H;

    const { error } = await this.supabase.from("rain_events").insert({
      station_id: NOAA_STATIONS.join(","),
      recorded_at: now.toISOString(),
      precipitation_inches_48h: avg,
      precipitation_inches_24h: avg24,
      advisory_active: advisoryActive,
    });
    if (error) throw new Error(`NOAA insert failed: ${error.message}`);

    return [];
  }

  /** Not used — rain readings are written directly to `rain_events`. */
  normalize(_raw: unknown): AdapterReading {
    return {
      externalSiteId: "",
      sampledAt: new Date(0).toISOString(),
      eColiMpn: null,
      enterococciCce: null,
      sampleMethod: null,
      sourceUrl: null,
      rawPayload: _raw,
    };
  }
}
