import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getWaterStatus, isStaleReading } from "@/lib/waterQualityEngine";
import {
  errorResponse,
  checkApiRateLimit,
  getRequestIp,
  jsonResponse,
  parseQuery,
  rateLimitHeaders,
} from "@/lib/apiRoute.server";

const querySchema = z
  .object({
    lat: z
      .string()
      .optional()
      .transform((value) => (value === undefined ? undefined : Number(value)))
      .refine((value) => value === undefined || Number.isFinite(value), {
        message: "lat must be a valid number",
      })
      .transform((value) => (value === undefined ? undefined : Number(value)))
      .pipe(z.number().min(-90).max(90).optional()),
    lng: z
      .string()
      .optional()
      .transform((value) => (value === undefined ? undefined : Number(value)))
      .refine((value) => value === undefined || Number.isFinite(value), {
        message: "lng must be a valid number",
      })
      .transform((value) => (value === undefined ? undefined : Number(value)))
      .pipe(z.number().min(-180).max(180).optional()),
    radius_km: z
      .string()
      .optional()
      .transform((value) => (value === undefined ? undefined : Number(value)))
      .refine((value) => value === undefined || Number.isFinite(value), {
        message: "radius_km must be a valid number",
      })
      .transform((value) => (value === undefined ? undefined : Number(value)))
      .pipe(z.number().nonnegative().optional()),
    site_type: z.string().optional(),
  })
  .refine(
    (params) =>
      (params.lat === undefined && params.lng === undefined) ||
      (params.lat !== undefined && params.lng !== undefined),
    {
      message: "Both lat and lng must be provided together",
      path: ["lat", "lng"],
    },
  )
  .refine(
    (params) =>
      params.radius_km === undefined || (params.lat !== undefined && params.lng !== undefined),
    {
      message: "radius_km requires lat and lng",
      path: ["radius_km"],
    },
  );

export const Route = createFileRoute("/api/sites")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ip = getRequestIp(request);
        const rate = await checkApiRateLimit(ip, "api_sites");
        if (!rate.allowed) {
          return errorResponse("Rate limit exceeded", "rate_limit_exceeded", 429, null, {
            ...rateLimitHeaders(rate),
            "Retry-After": String(rate.retryAfterSeconds),
          });
        }

        let params;
        try {
          params = parseQuery(request, querySchema);
        } catch (err) {
          return errorResponse(
            "Invalid query parameters",
            "invalid_query",
            400,
            err instanceof Error ? err.message : undefined,
            rateLimitHeaders(rate),
          );
        }

        // Optional auth — this endpoint is public; never reject on missing token.
        // When logged in, the client sends Authorization: Bearer <jwt> and we decode
        // the sub claim locally (no network round-trip) to pass to the RPC so it can
        // include the user's own sites alongside official ones.
        let requestingUserId: string | undefined;
        const authHeader = request.headers.get("authorization");
        if (authHeader?.startsWith("Bearer ")) {
          const token = authHeader.slice(7);
          const anonClient = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_PUBLISHABLE_KEY!,
            { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
          );
          const { data } = await anonClient.auth.getClaims(token);
          requestingUserId = data?.claims?.sub;
        }

        const useLocation = params.lat !== undefined && params.lng !== undefined;
        const features: Array<Record<string, unknown>> = [];

        try {
          {
            // Reuse the RPC for both paths — it performs the LATERAL join in
            // SQL, which scales to all 700+ sites without overflowing the
            // PostgREST `IN (...)` URL we used to send from the application.
            const lat = useLocation ? params.lat! : 38.9;
            const lng = useLocation ? params.lng! : -77.0;
            const { data: rows, error } = await supabaseAdmin.rpc("get_sites_with_latest_reading", {
              user_lat: lat,
              user_lng: lng,
              requesting_user_id: requestingUserId,
            });

            if (error) {
              console.error("[api/sites] rpc error:", error.message);
              return errorResponse(
                "An internal error occurred",
                "database_error",
                500,
                null,
                rateLimitHeaders(rate),
              );
            }

            const items = Array.isArray(rows) ? rows : [];
            const filtered = items.filter((row) =>
              params.site_type ? row.site_type === params.site_type : true,
            );
            const radiusFiltered = params.radius_km
              ? filtered.filter((row) => row.distance_km <= params.radius_km)
              : filtered;

            for (const row of radiusFiltered) {
              const status = getWaterStatus(
                row.e_coli_mpn,
                row.enterococci_cce,
                row.water_body_type as "freshwater" | "tidal_brackish",
                row.sampled_at,
              ).status;
              const stale = row.sampled_at ? isStaleReading(row.sampled_at) : false;

              features.push({
                type: "Feature",
                geometry: { type: "Point", coordinates: [row.lng, row.lat] },
                properties: {
                  id: row.site_id,
                  slug: row.slug,
                  name: row.name,
                  site_type: row.site_type,
                  water_body_type: row.water_body_type,
                  ada_accessible: row.ada_accessible,
                  address: row.address ?? null,
                  status,
                  isStale: stale,
                  stale,
                  e_coli_mpn: row.e_coli_mpn,
                  enterococci_cce: row.enterococci_cce,
                  sampled_at: row.sampled_at,
                  data_source: row.data_source,
                  distance_km: useLocation ? row.distance_km : null,
                  owner_id: (row as unknown as { owner_id: string | null }).owner_id ?? null,
                  description:
                    (row as unknown as { description: string | null }).description ?? null,
                },
              });
            }

            if (useLocation) {
              features.sort((a, b) => {
                const left = (a.properties as { distance_km: number | null }).distance_km;
                const right = (b.properties as { distance_km: number | null }).distance_km;
                return (left ?? Number.POSITIVE_INFINITY) - (right ?? Number.POSITIVE_INFINITY);
              });
            }
          }
        } catch (error) {
          console.error("[api/sites] unexpected error:", error);
          return errorResponse(
            "An internal error occurred",
            "server_error",
            500,
            null,
            rateLimitHeaders(rate),
          );
        }

        return jsonResponse({ type: "FeatureCollection", features }, 200, {
          ...rateLimitHeaders(rate),
          "Cache-Control": "public, max-age=3600",
        });
      },
    },
  },
});
