import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { NettleObservation } from "./types";

// nettle_observations only ever retains ~2 days (see the retention cron in
// its migration); 48h is a generous window to find "the latest row per
// station" without assuming any particular ingest cadence.
const LOOKBACK_MS = 48 * 60 * 60 * 1000;

/**
 * Latest sea nettle observation per CBIBS station, read directly from
 * nettle_observations (public SELECT, no server round trip needed).
 *
 * Returns [] while `enabled` is false so the map layer can skip the query
 * entirely until the user turns the layer on.
 */
export function useSeaNettleData(enabled: boolean): NettleObservation[] {
  const [observations, setObservations] = useState<NettleObservation[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;

    const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
    supabase
      .from("nettle_observations")
      .select(
        "station_code, station_name, lat, lng, observed_at, probability, water_temp_c, salinity_psu",
      )
      .gte("observed_at", since)
      .order("observed_at", { ascending: false })
      .then(({ data, error }) => {
        if (!active || error || !data) return;
        // Rows are ordered newest-first, so the first occurrence of a
        // station_code is its latest observation.
        const latestByStation = new Map<string, NettleObservation>();
        for (const row of data) {
          if (latestByStation.has(row.station_code)) continue;
          latestByStation.set(row.station_code, {
            stationCode: row.station_code,
            stationName: row.station_name,
            lat: Number(row.lat),
            lng: Number(row.lng),
            observedAt: row.observed_at,
            probability: Number(row.probability),
            waterTempC: row.water_temp_c != null ? Number(row.water_temp_c) : null,
            salinityPsu: row.salinity_psu != null ? Number(row.salinity_psu) : null,
          });
        }
        setObservations([...latestByStation.values()]);
      });

    return () => {
      active = false;
    };
  }, [enabled]);

  return observations;
}
