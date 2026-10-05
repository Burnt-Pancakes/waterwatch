/**
 * Open Data DC marinas adapter (weekly).
 *
 * Pulls the DCGIS "Marinas" layer (ID 6 in the Recreation MapServer)
 * inside the DMV bounding box and surfaces each as a discovery
 * candidate. All DC marinas sit on tidal Potomac/Anacostia water, so
 * we hard-code water_body_type = tidal_brackish.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdapterReading, AdapterSite, DataSourceAdapter } from "./base";
import {
  fetchArcGisGeoJson,
  featureCoords,
  type ArcGisFeature,
  type ArcGisFeatureCollection,
} from "./arcgis";

export const OPEN_DATA_DC_MARINAS_URL =
  "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Recreation_WebMercator/MapServer/6/query" +
  "?where=1%3D1&outFields=*&f=geojson" +
  "&geometry=-77.12,38.80,-76.91,38.99" +
  "&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects";

export function mapDcMarinaFeature(f: ArcGisFeature): AdapterSite | null {
  const props = f.properties ?? {};
  const name = (props.NAME ?? props.name) as string | undefined;
  if (!name || !name.trim()) return null;
  const coords = featureCoords(f);
  if (!coords) return null;
  // Object IDs in the layer are stable per release — pair with a source
  // tag so the externalId can't collide with OSM ids.
  const objectId = (props.OBJECTID ?? props.objectid ?? props.OBJECTID_1) as
    | number
    | string
    | undefined;
  const externalId = `opendatadc:marina:${objectId ?? name.trim().toLowerCase().replace(/\s+/g, "-")}`;
  return {
    externalId,
    name: name.trim(),
    lat: coords.lat,
    lng: coords.lng,
    waterBodyType: "tidal_brackish",
    siteType: "marina",
  };
}

export class OpenDataDCAdapter implements DataSourceAdapter {
  sourceId = "opendatadc";
  displayName = "Open Data DC (Marinas)";

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
