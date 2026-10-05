/**
 * GET /api/gauges/by-site/:siteId
 *
 * Returns river gauge metadata, thresholds, current reading and 24h history
 * for the gauge linked to a water-quality site via `sites.nearest_gauge_id`.
 *
 * Returns 404 when the site has no nearest_gauge_id so the UI can hide the
 * river-stage card.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { errorResponse, jsonResponse } from "@/lib/apiRoute.server";
import type { SupabaseClient } from "@supabase/supabase-js";

export type GaugeReadingRow = {
  recorded_at: string;
  stage_ft: number | null;
  flow_cfs: number | null;
  trend: "rising" | "falling" | "steady" | null;
};

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// Cast around generated Database types for river_* tables.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as unknown as SupabaseClient<any>;

export const Route = createFileRoute("/api/gauges/by-site/siteId")({
  server: {
    handlers: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      GET: async ({ params }: { request: Request; params: any }) => {
        const siteId = params?.siteId as string | undefined;
        if (!siteId) return errorResponse("Missing site id", "invalid_request", 400);

        const { data: site, error: siteErr } = await db
          .from("sites")
          .select("nearest_gauge_id")
          .eq("id", siteId)
          .maybeSingle();

        if (siteErr) {
          console.error("[api/gauges/by-site] site err:", siteErr.message);
          return errorResponse("An internal error occurred", "database_error", 500);
        }
        if (!site?.nearest_gauge_id) {
          return errorResponse("No gauge for this site", "not_found", 404);
        }

        const gaugeId = site.nearest_gauge_id as string;

        const [{ data: gauge, error: gErr }, { data: thresholds }] = await Promise.all([
          db
            .from("river_gauges")
            .select("id, usgs_site_number, name, lat, lng, state_code, county")
            .eq("id", gaugeId)
            .maybeSingle(),
          db
            .from("stage_thresholds")
            .select("too_low_ft, optimal_min_ft, optimal_max_ft, caution_max_ft, notes")
            .eq("station_id", gaugeId)
            .maybeSingle(),
        ]);

        if (gErr || !gauge) {
          return errorResponse("Gauge not found", "not_found", 404);
        }

        const cutoff = new Date(Date.now() - TWENTY_FOUR_HOURS_MS).toISOString();
        const { data: readings, error: rErr } = await db
          .from("gauge_readings")
          .select("recorded_at, stage_ft, flow_cfs, trend")
          .eq("station_id", gaugeId)
          .gte("recorded_at", cutoff)
          .order("recorded_at", { ascending: false });

        if (rErr) {
          console.error("[api/gauges/by-site] readings err:", rErr.message);
          return errorResponse("An internal error occurred", "database_error", 500);
        }

        const history = (readings ?? []) as GaugeReadingRow[];
        const current = history[0] ?? null;

        return jsonResponse({ gauge, thresholds: thresholds ?? null, current, history }, 200, {
          "Cache-Control": "public, max-age=300",
        });
      },
    },
  },
});
