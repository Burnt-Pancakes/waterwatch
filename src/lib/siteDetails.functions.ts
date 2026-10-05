import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SiteStatus } from "@/components/map/SiteMarker";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getWaterStatus,
  isStaleReading,
  shouldShowRainAdvisory,
  calculateGeometricMean,
  STATUS_CONFIG,
} from "@/lib/waterQualityEngine";

interface RainEventRow {
  recorded_at: string;
  precipitation_inches_48h: number;
  precipitation_inches_24h: number | null;
  advisory_active: boolean;
}

/**
 * Public read of all data needed to render the site bottom sheet expanded view.
 * Public-readable tables only; uses `supabaseAdmin` with explicit projection so
 * we never need a public RLS policy that opens user data.
 */
export const getSiteDetails = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ siteId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { siteId } = data;

    const [{ data: site, error: siteErr }, { data: readings }, { data: rain }] = await Promise.all([
      supabaseAdmin
        .from("sites")
        .select(
          "id, slug, name, site_type, water_body_type, lat, lng, address, description, amenities, parking_notes, ada_accessible, data_source_ids",
        )
        .eq("id", siteId)
        .maybeSingle(),
      supabaseAdmin
        .from("readings")
        .select(
          "id, sampled_at, e_coli_mpn, enterococci_cce, sample_method, data_source, source_url, status",
        )
        .eq("site_id", siteId)
        .order("sampled_at", { ascending: false })
        .limit(90),
      (supabaseAdmin as unknown as SupabaseClient)
        .from("rain_events")
        .select("recorded_at, precipitation_inches_48h, precipitation_inches_24h, advisory_active")
        .not("precipitation_inches_24h", "is", null)
        .order("recorded_at", { ascending: false })
        .limit(1),
    ]);

    if (siteErr) throw new Error(siteErr.message);
    if (!site) throw new Error("Site not found");

    const latest = readings?.[0] ?? null;
    const waterBodyType = site.water_body_type as "freshwater" | "tidal_brackish";
    const cfg = latest
      ? getWaterStatus(latest.e_coli_mpn, latest.enterococci_cce, waterBodyType, latest.sampled_at)
      : STATUS_CONFIG.no_data;

    const stale = latest ? isStaleReading(latest.sampled_at) : false;

    // 30-day geometric mean (EPA requires >= 5 samples).
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const last30 = (readings ?? []).filter((r) => Date.parse(r.sampled_at) >= cutoff);
    const values30 = last30
      .map((r) => (waterBodyType === "freshwater" ? r.e_coli_mpn : r.enterococci_cce))
      .filter((v): v is number => typeof v === "number");
    const gmValue = calculateGeometricMean(values30);
    const gmStatus = gmValue
      ? getWaterStatus(
          waterBodyType === "freshwater" ? gmValue : null,
          waterBodyType === "tidal_brackish" ? gmValue : null,
          waterBodyType,
          new Date().toISOString(),
        )
      : null;

    const rainEvt = (rain as RainEventRow[] | null)?.[0] ?? null;
    const advisoryActive = !!(
      rainEvt &&
      rainEvt.advisory_active &&
      shouldShowRainAdvisory(rainEvt.precipitation_inches_48h ?? 0)
    );
    const precipInches24h = rainEvt?.precipitation_inches_24h ?? null;

    return {
      site,
      latest,
      status: cfg.status,
      stale,
      advisoryActive,
      precipInches24h,
      readings: readings ?? [],
      geometricMean:
        gmValue && gmStatus
          ? { value: gmValue, status: gmStatus.status, label: gmStatus.label }
          : null,
    };
  });

/**
 * Same as getSiteDetails but accepts a URL slug instead of a UUID.
 * Returns null when no active site matches the slug (renders a 404 page).
 */
export const getSiteDetailsBySlug = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ slug: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const { data: siteMeta } = await supabaseAdmin
      .from("sites")
      .select("id")
      .eq("slug", data.slug)
      .eq("is_active", true)
      .maybeSingle();

    if (!siteMeta) return null as null;

    const siteId = siteMeta.id;

    const [{ data: site, error: siteErr }, { data: readings }, { data: rain }] = await Promise.all([
      supabaseAdmin
        .from("sites")
        .select(
          "id, slug, name, site_type, water_body_type, lat, lng, address, description, amenities, parking_notes, ada_accessible, data_source_ids",
        )
        .eq("id", siteId)
        .maybeSingle(),
      supabaseAdmin
        .from("readings")
        .select(
          "id, sampled_at, e_coli_mpn, enterococci_cce, sample_method, data_source, source_url, status",
        )
        .eq("site_id", siteId)
        .order("sampled_at", { ascending: false })
        .limit(90),
      (supabaseAdmin as unknown as SupabaseClient)
        .from("rain_events")
        .select("recorded_at, precipitation_inches_48h, precipitation_inches_24h, advisory_active")
        .not("precipitation_inches_24h", "is", null)
        .order("recorded_at", { ascending: false })
        .limit(1),
    ]);

    if (siteErr || !site) return null as null;

    const latest = readings?.[0] ?? null;
    const waterBodyType = site.water_body_type as "freshwater" | "tidal_brackish";
    const cfg = latest
      ? getWaterStatus(latest.e_coli_mpn, latest.enterococci_cce, waterBodyType, latest.sampled_at)
      : STATUS_CONFIG.no_data;

    const stale = latest ? isStaleReading(latest.sampled_at) : false;

    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const last30 = (readings ?? []).filter((r) => Date.parse(r.sampled_at) >= cutoff);
    const values30 = last30
      .map((r) => (waterBodyType === "freshwater" ? r.e_coli_mpn : r.enterococci_cce))
      .filter((v): v is number => typeof v === "number");
    const gmValue = calculateGeometricMean(values30);
    const gmStatus = gmValue
      ? getWaterStatus(
          waterBodyType === "freshwater" ? gmValue : null,
          waterBodyType === "tidal_brackish" ? gmValue : null,
          waterBodyType,
          new Date().toISOString(),
        )
      : null;

    const rainEvt = (rain as RainEventRow[] | null)?.[0] ?? null;
    const advisoryActive = !!(
      rainEvt &&
      rainEvt.advisory_active &&
      shouldShowRainAdvisory(rainEvt.precipitation_inches_48h ?? 0)
    );
    const precipInches24h = rainEvt?.precipitation_inches_24h ?? null;

    return {
      site: site as NonNullable<typeof site> & { site_type: string },
      latest,
      status: cfg.status as SiteStatus,
      stale,
      advisoryActive,
      precipInches24h,
      readings: readings ?? [],
      geometricMean:
        gmValue && gmStatus
          ? { value: gmValue, status: gmStatus.status, label: gmStatus.label }
          : null,
    };
  });
