import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { WaterTempReading, WaterTempState } from "./types";

type RpcRow = {
  temp_c: number;
  observed_at: string;
  station_name: string | null;
  source: string;
  distance_km: number;
};

/**
 * Calls nearest_water_temp(p_lat, p_lng) and returns the result as WaterTempState.
 * Returns { reading: null, isLoading: false } when lat/lng are null.
 */
export function useWaterTempData(lat: number | null, lng: number | null): WaterTempState {
  const [state, setState] = useState<WaterTempState>({
    reading: null,
    isLoading: false,
    error: null,
  });

  useEffect(() => {
    if (lat == null || lng == null) return;

    let active = true;
    setState({ reading: null, isLoading: true, error: null });

    (async () => {
      try {
        const sb = supabase as unknown as SupabaseClient;
        const { data, error } = await sb.rpc("nearest_water_temp", {
          p_lat: lat,
          p_lng: lng,
        });

        if (!active) return;

        if (error) {
          setState({ reading: null, isLoading: false, error: error.message });
          return;
        }

        const rows = Array.isArray(data) ? (data as RpcRow[]) : [];
        const row = rows[0] ?? null;

        if (!row) {
          setState({ reading: null, isLoading: false, error: null });
          return;
        }

        setState({
          reading: {
            tempC: Number(row.temp_c),
            observedAt: row.observed_at,
            stationName: row.station_name ?? "Unknown station",
            source: row.source,
            distanceKm: Number(row.distance_km),
          },
          isLoading: false,
          error: null,
        });
      } catch {
        if (active) {
          setState({ reading: null, isLoading: false, error: "Failed to load water temperature" });
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [lat, lng]);

  return state;
}
