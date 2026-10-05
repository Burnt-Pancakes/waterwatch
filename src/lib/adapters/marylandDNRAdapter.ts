/**
 * Maryland DNR public water access adapter (weekly).
 *
 * Source: ArcGIS Online MD DNR Public_Water_Access_2020 FeatureServer.
 * Maps each access point into a discovery candidate, choosing:
 *
 *   - siteType      = "kayak_launch" when BoatRamp is not "Yes" and SoftAccess is "Yes",
 *                     else "boat_ramp"
 *   - waterBodyType = "tidal_brackish" when WaterBody mentions Potomac or Chesapeake,
 *                     else "freshwater"
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdapterReading, AdapterSite, DataSourceAdapter } from "./base";
import {
  fetchArcGisGeoJson,
  featureCoords,
  type ArcGisFeature,
  type ArcGisFeatureCollection,
} from "./arcgis";

export const MD_DNR_BOATING_URL =
  "https://services.arcgis.com/njFNhDsUCentVYJW/arcgis/rest/services/Public_Water_Access_2020/FeatureServer/0/query" +
  "?where=County+IN+('Prince+George''s','Montgomery','Charles','Anne+Arundel','Calvert','St.+Mary''s')" +
  "&outFields=*&f=geojson";

export function classifyMdSite(
  boatRamp: string | undefined,
  softAccess: string | undefined,
  waterBody: string | undefined,
): { siteType: AdapterSite["siteType"]; waterBodyType: AdapterSite["waterBodyType"] } {
  const siteType: AdapterSite["siteType"] =
    (boatRamp ?? "").toLowerCase() !== "yes" && (softAccess ?? "").toLowerCase() === "yes"
      ? "kayak_launch"
      : "boat_ramp";
  const water = (waterBody ?? "").toLowerCase();
  const waterBodyType: AdapterSite["waterBodyType"] =
    water.includes("potomac") || water.includes("chesapeake") ? "tidal_brackish" : "freshwater";
  return { siteType, waterBodyType };
}

export function mapMdSiteFeature(f: ArcGisFeature): AdapterSite | null {
  const props = f.properties ?? {};
  const name = (props.SiteName ?? props.SITE_NAME) as string | undefined;
  if (!name || !name.trim()) return null;
  const coords = featureCoords(f);
  if (!coords) return null;
  const { siteType, waterBodyType } = classifyMdSite(
    props.BoatRamp as string | undefined,
    props.SoftAccess as string | undefined,
    props.WaterBody as string | undefined,
  );
  const objectId = (props.OBJECTID ?? props.objectid) as number | string | undefined;
  const externalId = `mddnr:site:${objectId ?? name.trim().toLowerCase().replace(/\s+/g, "-")}`;
  return {
    externalId,
    name: name.trim(),
    lat: coords.lat,
    lng: coords.lng,
    waterBodyType,
    siteType,
  };
}

export class MarylandDNRAdapter implements DataSourceAdapter {
  sourceId = "mddnr";
  displayName = "Maryland DNR Public Water Access";

  constructor(
    private readonly supabase: Pick<SupabaseClient, "from">,
    private readonly fetchImpl: (
      url: string,
    ) => Promise<ArcGisFeatureCollection> = fetchArcGisGeoJson,
  ) {}

  async fetchSites(): Promise<AdapterSite[]> {
    const collection = await this.fetchImpl(MD_DNR_BOATING_URL);
    return (collection.features ?? [])
      .map(mapMdSiteFeature)
      .filter((s): s is AdapterSite => s !== null);
  }

  async fetchReadings(): Promise<AdapterReading[]> {
    return [];
  }

  normalize(raw: unknown): AdapterReading {
    return {
      externalSiteId: "",
      sampledAt: new Date(0).toISOString(),
      eColiMpn: null,
      enterococciCce: null,
      sampleMethod: null,
      sourceUrl: null,
      rawPayload: raw,
    };
  }
}
