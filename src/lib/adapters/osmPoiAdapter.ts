/**
 * OpenStreetMap POI adapter (runs weekly).
 *
 * Queries the Overpass API for water-recreation POIs inside a DMV
 * bounding box and upserts them into `sites` matched on `osm_id`.
 * Sites already refreshed within the last 7 days are skipped so we
 * don't churn rows or hammer Overpass.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdapterReading, AdapterSite, DataSourceAdapter } from "./base";
import { persistDiscoveredSites } from "./discovery";
import { slugify } from "./slug";

// Re-export so existing call sites (and tests) keep working.
export { slugify };

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
/** South, West, North, East — DMV-ish. */
export const DMV_BBOX = [38.7, -77.5, 39.1, -76.8] as const;
/** How recently must `updated_at` be for us to skip the row? */
export const OSM_REFRESH_DAYS = 7;

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

type OverpassResponse = { elements?: OverpassElement[] };

/** Map OSM tags to our site_type enum. Returns null when no match. */
export function osmTagsToSiteType(
  tags: Record<string, string> | undefined,
): AdapterSite["siteType"] | null {
  if (!tags) return null;
  if (tags.amenity === "boat_ramp") return "boat_ramp";
  if (tags.amenity === "canoe_rental") return "kayak_launch";
  if (tags.leisure === "marina") return "marina";
  if (tags.leisure === "beach") return "beach";
  // Water parks are usually swim destinations on a body of water in the
  // DMV (e.g. Hains Point pool, public splash pads on the Anacostia).
  if (tags.leisure === "water_park") return "swim_area";
  if (tags.sport === "kayak") return "kayak_launch";
  if (tags.sport === "swimming") return "swim_area";
  return null;
}

/** Build the Overpass QL query for the DMV bbox. */
export function buildOverpassQuery(bbox: readonly [number, number, number, number]): string {
  const [s, w, n, e] = bbox;
  return `
[out:json][timeout:60];
(
  node["amenity"="boat_ramp"](${s},${w},${n},${e});
  node["amenity"="canoe_rental"](${s},${w},${n},${e});
  node["leisure"="marina"](${s},${w},${n},${e});
  way["leisure"="marina"](${s},${w},${n},${e});
  node["leisure"="beach"](${s},${w},${n},${e});
  way["leisure"="beach"](${s},${w},${n},${e});
  node["leisure"="water_park"](${s},${w},${n},${e});
  way["leisure"="water_park"](${s},${w},${n},${e});
  node["sport"="kayak"](${s},${w},${n},${e});
  node["sport"="swimming"](${s},${w},${n},${e});
);
out center;`.trim();
}

async function fetchJson(body: string): Promise<unknown> {
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body,
  });
  if (!res.ok) throw new Error(`Overpass ${res.status} ${res.statusText}`);
  return res.json();
}

export class OsmPoiAdapter implements DataSourceAdapter {
  sourceId = "osm_poi";
  displayName = "OpenStreetMap POIs";

  constructor(
    private readonly supabase: Pick<SupabaseClient, "from">,
    private readonly fetchImpl: (body: string) => Promise<unknown> = fetchJson,
    private readonly nowFn: () => Date = () => new Date(),
  ) {}

  /**
   * Query Overpass, convert elements to {@link AdapterSite}, and upsert
   * matching on `osm_id`. Returns the list of fresh AdapterSite objects
   * for caller visibility.
   */
  async fetchSites(): Promise<AdapterSite[]> {
    const payload = (await this.fetchImpl(buildOverpassQuery(DMV_BBOX))) as OverpassResponse;
    const elements = payload.elements ?? [];

    const sites: AdapterSite[] = [];
    for (const el of elements) {
      const siteType = osmTagsToSiteType(el.tags);
      if (!siteType) continue;
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (lat === undefined || lng === undefined) continue;
      const name = el.tags?.name?.trim();
      if (!name) continue; // Unnamed POIs aren't useful to surface to users.
      sites.push({
        externalId: `osm:${el.type}/${el.id}`,
        name,
        lat,
        lng,
        // OSM doesn't tag fresh vs tidal — default to freshwater and let
        // editors override in the DB if a site is actually tidal.
        waterBodyType: "freshwater",
        siteType,
      });
    }

    await persistDiscoveredSites(this.supabase, this.sourceId, sites, {
      skipIfRefreshedWithinDays: OSM_REFRESH_DAYS,
      nowFn: this.nowFn,
    });
    return sites;
  }

  async fetchReadings(): Promise<AdapterReading[]> {
    return []; // OSM has no bacteria readings.
  }

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
