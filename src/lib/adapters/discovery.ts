/**
 * Shared persistence helper for "discovery" adapters — sources that
 * surface new water-access sites (OSM, Open Data DC, Maryland DNR,
 * Virginia DWR). Discovery adapters DO NOT supply water-quality
 * readings; they only seed the location database for an admin to
 * verify and activate.
 *
 * Rules enforced here (mirrors the adapter spec):
 *   1. Match existing rows on `osm_id` (using `<source>:<external-id>`
 *      for non-OSM sources to keep the namespace flat).
 *   2. New rows insert with `is_active = false` so an admin must
 *      explicitly activate them after verifying location/metadata.
 *   3. Skip candidates whose name matches an existing site within
 *      100 meters (case-insensitive, trimmed).
 *   4. Optionally skip candidates whose existing row was refreshed
 *      within `skipIfRefreshedWithinDays` days (used by the OSM
 *      adapter to avoid weekly Overpass churn).
 *   5. Log counts of inserted / refreshed / skipped sites.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { distanceKm } from "@/lib/geo";
import type { AdapterSite } from "./base";
import { slugify } from "./slug";

export type DiscoveryResult = {
  inserted: number;
  refreshed: number;
  skipped: number;
};

type SiteRowLite = {
  name: string | null;
  lat: number | null;
  lng: number | null;
  osm_id: string | null;
};

type ExistingRow = {
  osm_id: string | null;
  updated_at: string | null;
};

/** 100 meters in km, expressed once for clarity. */
const DEDUP_RADIUS_KM = 0.1;

export async function persistDiscoveredSites(
  supabase: Pick<SupabaseClient, "from">,
  sourceId: string,
  sites: AdapterSite[],
  opts: { skipIfRefreshedWithinDays?: number; nowFn?: () => Date } = {},
): Promise<DiscoveryResult> {
  const result: DiscoveryResult = { inserted: 0, refreshed: 0, skipped: 0 };
  if (sites.length === 0) {
    console.log(`[${sourceId}] discovery: 0 candidates`);
    return result;
  }

  const nowFn = opts.nowFn ?? (() => new Date());

  // 1. Which of our candidate externalIds already exist?
  const externalIds = sites.map((s) => s.externalId);
  const { data: existing, error: e1 } = await supabase
    .from("sites")
    .select("osm_id, updated_at")
    .in("osm_id", externalIds);
  if (e1) throw new Error(`${sourceId} existing lookup failed: ${e1.message}`);

  const existingMap = new Map<string, ExistingRow>();
  for (const row of (existing ?? []) as ExistingRow[]) {
    if (row.osm_id) existingMap.set(row.osm_id, row);
  }

  // 2. Pull every active site for the name+distance dedup pass. The
  //    sites table is small (hundreds of rows) so an in-memory scan is
  //    fine and keeps the SQL simple (no PostGIS available).
  const { data: allSites, error: e2 } = await supabase
    .from("sites")
    .select("name, lat, lng, osm_id");
  if (e2) throw new Error(`${sourceId} all-sites lookup failed: ${e2.message}`);

  const refreshCutoff =
    opts.skipIfRefreshedWithinDays !== undefined
      ? nowFn().getTime() - opts.skipIfRefreshedWithinDays * 86_400_000
      : null;

  const toInsert: Array<Record<string, unknown>> = [];
  const toRefresh: Array<Record<string, unknown>> = [];

  for (const site of sites) {
    const prior = existingMap.get(site.externalId);
    if (prior) {
      if (
        refreshCutoff !== null &&
        prior.updated_at &&
        Date.parse(prior.updated_at) > refreshCutoff
      ) {
        result.skipped++;
        continue;
      }
      // Refresh name/coords without disturbing is_active (admins may
      // have activated this row manually).
      toRefresh.push({
        osm_id: site.externalId,
        name: site.name,
        lat: site.lat,
        lng: site.lng,
      });
      result.refreshed++;
      continue;
    }

    // Brand new candidate — run the 100m / name dedup before insert.
    const normName = site.name.trim().toLowerCase();
    const isDuplicate = ((allSites ?? []) as SiteRowLite[]).some((row) => {
      const rowName = row.name?.trim().toLowerCase();
      if (!rowName || rowName !== normName) return false;
      if (row.lat === null || row.lng === null) return false;
      return distanceKm(site.lat, site.lng, row.lat, row.lng) <= DEDUP_RADIUS_KM;
    });
    if (isDuplicate) {
      result.skipped++;
      continue;
    }

    toInsert.push({
      osm_id: site.externalId,
      name: site.name,
      slug: slugify(site.name, site.externalId.replace(/[^a-z0-9]+/gi, "-")),
      site_type: site.siteType,
      water_body_type: site.waterBodyType,
      lat: site.lat,
      lng: site.lng,
      is_active: false,
      data_source_ids: [sourceId],
    });
    result.inserted++;
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from("sites").upsert(toInsert, { onConflict: "osm_id" });
    if (error) throw new Error(`${sourceId} insert failed: ${error.message}`);
  }
  if (toRefresh.length > 0) {
    const { error } = await supabase.from("sites").upsert(toRefresh, { onConflict: "osm_id" });
    if (error) throw new Error(`${sourceId} refresh failed: ${error.message}`);
  }

  console.log(
    `[${sourceId}] discovery: ${result.inserted} new, ${result.refreshed} refreshed, ${result.skipped} skipped`,
  );
  return result;
}
