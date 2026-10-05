import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { calculateGeometricMean } from "@/lib/waterQualityEngine";
import {
  errorResponse,
  checkApiRateLimit,
  getRequestIp,
  jsonResponse,
  rateLimitHeaders,
  parseQuery,
} from "@/lib/apiRoute.server";

const querySchema = z.object({
  days: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? undefined : Number(value)))
    .refine((value) => value === undefined || Number.isFinite(value), {
      message: "days must be a number",
    })
    .transform((value) => (value === undefined ? 90 : Number(value)))
    .pipe(z.number().int().min(1).max(365)),
});

export const Route = createFileRoute("/api/sites/slug/readings")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ip = getRequestIp(request);
        const rate = await checkApiRateLimit(ip, "api_sites_readings");
        if (!rate.allowed) {
          return errorResponse("Rate limit exceeded", "rate_limit_exceeded", 429, null, {
            ...rateLimitHeaders(rate),
            "Retry-After": String(rate.retryAfterSeconds),
          });
        }

        const url = new URL(request.url);
        const pathSegments = url.pathname.split("/").filter(Boolean);
        const slug = pathSegments[2];
        if (!slug) {
          return errorResponse(
            "Missing site slug",
            "invalid_request",
            400,
            null,
            rateLimitHeaders(rate),
          );
        }

        let parsed;
        try {
          parsed = parseQuery(request, querySchema);
        } catch (err) {
          return errorResponse(
            "Invalid query parameters",
            "invalid_query",
            400,
            err instanceof Error ? err.message : undefined,
            rateLimitHeaders(rate),
          );
        }

        const { data: site, error: siteError } = await supabaseAdmin
          .from("sites")
          .select("id, is_active")
          .eq("slug", slug)
          .eq("is_active", true)
          .maybeSingle();

        if (siteError) {
          console.error("[api/sites/:slug/readings] site query error:", siteError.message);
          return errorResponse(
            "An internal error occurred",
            "database_error",
            500,
            null,
            rateLimitHeaders(rate),
          );
        }

        if (!site) {
          return errorResponse("Site not found", "not_found", 404, null, rateLimitHeaders(rate));
        }

        const { data: readings, error: historyError } = await supabaseAdmin.rpc(
          "get_site_readings_history",
          {
            p_site_id: site.id,
            days_back: parsed.days,
          },
        );

        if (historyError) {
          console.error("[api/sites/:slug/readings] history rpc error:", historyError.message);
          return errorResponse(
            "An internal error occurred",
            "database_error",
            500,
            null,
            rateLimitHeaders(rate),
          );
        }

        const recentThreshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const recentReadings = (readings ?? []).filter(
          (row: { sampled_at: string }) => Date.parse(row.sampled_at) >= recentThreshold,
        );
        const values = recentReadings
          .map((row: { e_coli_mpn: number | null; enterococci_cce: number | null }) => {
            return typeof row.e_coli_mpn === "number" ? row.e_coli_mpn : row.enterococci_cce;
          })
          .filter((value): value is number => typeof value === "number");

        const geometricMean = values.length >= 5 ? calculateGeometricMean(values) : null;

        return jsonResponse(
          {
            readings: readings ?? [],
            geometricMean,
          },
          200,
          {
            ...rateLimitHeaders(rate),
            "Cache-Control": "public, max-age=1800",
          },
        );
      },
    },
  },
});
