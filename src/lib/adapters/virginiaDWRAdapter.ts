/**
 * Virginia DWR boating-access adapter (weekly).
 *
 * Source: ArcGIS Online hosted layer for DWR_Boating_Access. DWR sites
 * default to boat_ramp / freshwater; we promote to tidal_brackish when
 * the site sits within a rough Potomac corridor near DC/Alexandria.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdapterReading, AdapterSite, DataSourceAdapter } from "./base";
import {
  fetchArcGisGeoJson,
  featureCoords,
  type ArcGisFeature,
  type ArcGisFeatureCollection,
} from "./arcgis";

export const VA_DWR_BOATING_URL =
  "https://services.arcgis.com/p5v98VHDX9Atv3l7/arcgis/rest/services/DWR_Boating_Access/FeatureServer/0/query" +
  "?where=1%3D1&outFields=*&f=geojson" +
  "&geometry=-77.5,38.7,-77.0,39.0" +
  "&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects";

/**
 * Rough heuristic: anything east of -77.10 inside the bbox is on or
 * near the tidal Potomac (Alexandria, Mt Vernon, Belle Haven), the rest
 * is interior Northern Virginia freshwater.
 */
export function vaWaterBodyType(lat: number, lng: number): AdapterSite["waterBodyType"] {
  if (lng >= -77.1 && lat >= 38.7 && lat <= 39.0) return "tidal_brackish";
  return "freshwater";
}

export function mapVaDwrFeature(f: ArcGisFeature): AdapterSite | null {
  const props = f.properties ?? {};
  const name = (props.SITE_NAME ?? props.site_name ?? props.NAME) as string | undefined;
  if (!name || !name.trim()) return null;
  const coords = featureCoords(f);
  if (!coords) return null;
  const objectId = (props.OBJECTID ?? props.objectid) as number | string | undefined;
  const externalId = `vadwr:site:${objectId ?? name.trim().toLowerCase().replace(/\s+/g, "-")}`;
  return {
    externalId,
    name: name.trim(),
    lat: coords.lat,
    lng: coords.lng,
    waterBodyType: vaWaterBodyType(coords.lat, coords.lng),
    siteType: "boat_ramp",
  };
}

export class VirginiaDWRAdapter implements DataSourceAdapter {
  sourceId = "vadwr";
  displayName = "Virginia DWR Boating Access";

  constructor(
    private readonly supabase: Pick<SupabaseClient, "from">,
    private readonly fetchImpl: (
      url: string,
    ) => Promise<ArcGisFeatureCollection> = fetchArcGisGeoJson,
  ) {}

  async fetchSites(): Promise<AdapterSite[]> {
    console.log(
      `[${this.sourceId}] Adapter disabled — endpoint URL requires verification. Manual seed data used instead.`,
    );
    return [];
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
