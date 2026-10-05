import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getWaterStatus, isStaleReading } from "@/lib/waterQualityEngine";
import type { SiteStatus } from "@/components/map/SiteMarker";

export type FavoriteWithStatus = {
  favoriteId: string;
  siteId: string;
  siteName: string;
  siteSlug: string;
  siteType: string;
  waterBodyType: string;
  status: SiteStatus;
  stale: boolean;
  sampledAt: string | null;
  eColiMpn: number | null;
  enterococciCce: number | null;
  lat: number;
  lng: number;
};

const SEVERITY: Record<SiteStatus, number> = {
  unsafe: 3,
  caution: 2,
  pass: 1,
  no_data: 0,
};

export const getFavoritesWithStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;

    const { data: favorites, error } = await supabaseAdmin
      .from("favorites")
      .select("id, site_id, sites(id, name, slug, site_type, water_body_type, lat, lng)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    if (!favorites?.length) return [] as FavoriteWithStatus[];

    const siteIds = favorites.map((f) => f.site_id);

    // Fetch recent readings for all favorite sites; pick latest per site in JS.
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: readings } = await supabaseAdmin
      .from("readings")
      .select("site_id, sampled_at, e_coli_mpn, enterococci_cce")
      .in("site_id", siteIds)
      .gte("sampled_at", cutoff)
      .order("sampled_at", { ascending: false });

    const latestBySite = new Map<
      string,
      {
        site_id: string;
        sampled_at: string;
        e_coli_mpn: number | null;
        enterococci_cce: number | null;
      }
    >();
    for (const r of readings ?? []) {
      if (!latestBySite.has(r.site_id)) latestBySite.set(r.site_id, r);
    }

    const result: FavoriteWithStatus[] = [];
    for (const fav of favorites) {
      const site = fav.sites as {
        id: string;
        name: string;
        slug: string;
        site_type: string;
        water_body_type: string;
        lat: number;
        lng: number;
      } | null;
      if (!site) continue;

      const reading = latestBySite.get(fav.site_id) ?? null;
      const wbt = (site.water_body_type ?? "freshwater") as "freshwater" | "tidal_brackish";
      const cfg = reading
        ? getWaterStatus(reading.e_coli_mpn, reading.enterococci_cce, wbt, reading.sampled_at)
        : { status: "no_data" as SiteStatus };

      result.push({
        favoriteId: fav.id,
        siteId: fav.site_id,
        siteName: site.name,
        siteSlug: site.slug,
        siteType: site.site_type,
        waterBodyType: site.water_body_type,
        status: cfg.status as SiteStatus,
        stale: reading ? isStaleReading(reading.sampled_at) : false,
        sampledAt: reading?.sampled_at ?? null,
        eColiMpn: reading?.e_coli_mpn ?? null,
        enterococciCce: reading?.enterococci_cce ?? null,
        lat: site.lat,
        lng: site.lng,
      });
    }

    result.sort((a, b) => (SEVERITY[b.status] ?? 0) - (SEVERITY[a.status] ?? 0));
    return result;
  });

export const removeFavorite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ favoriteId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { error } = await supabaseAdmin
      .from("favorites")
      .delete()
      .eq("id", data.favoriteId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
