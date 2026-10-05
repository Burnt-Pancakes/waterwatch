import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getWaterStatus, isStaleReading } from "@/lib/waterQualityEngine";
import {
  errorResponse,
  checkApiRateLimit,
  getRequestIp,
  jsonResponse,
  rateLimitHeaders,
  parseQuery,
} from "@/lib/apiRoute.server";
import { z } from "zod";

const querySchema = z.object({});

export const Route = createFileRoute("/api/sites/slug")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const ip = getRequestIp(request);
        const rate = await checkApiRateLimit(ip, "api_sites_detail");
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

        try {
          parseQuery(request, querySchema);
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
          .select(
            "id, slug, name, site_type, water_body_type, lat, lng, address, description, amenities, parking_notes, ada_accessible, data_source_ids, is_active",
          )
          .eq("slug", slug)
          .eq("is_active", true)
          .maybeSingle();

        if (siteError) {
          console.error("[api/sites/:slug] site query error:", siteError.message);
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

        const [{ data: readings }, { data: rain, error: rainError }] = await Promise.all([
          supabaseAdmin
            .from("readings")
            .select(
              "id, sampled_at, e_coli_mpn, enterococci_cce, sample_method, data_source, source_url, status",
            )
            .eq("site_id", site.id)
            .order("sampled_at", { ascending: false })
            .limit(1),
          supabaseAdmin
            .from("rain_events")
            .select("recorded_at, precipitation_inches_48h, advisory_active")
            .eq("advisory_active", true)
            .order("recorded_at", { ascending: false })
            .limit(1),
        ]);

        if (rainError) {
          console.error("[api/sites/:slug] rain query error:", rainError.message);
          return errorResponse(
            "An internal error occurred",
            "database_error",
            500,
            null,
            rateLimitHeaders(rate),
          );
        }

        const latest = readings?.[0] ?? null;
        const waterBodyType = site.water_body_type as "freshwater" | "tidal_brackish";
        const status = latest
          ? getWaterStatus(
              latest.e_coli_mpn,
              latest.enterococci_cce,
              waterBodyType,
              latest.sampled_at,
            ).status
          : "no_data";
        const isStale = latest ? isStaleReading(latest.sampled_at) : false;

        return jsonResponse(
          {
            site,
            latest,
            status,
            isStale,
            activeRainAdvisory: rain?.[0] ?? null,
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
