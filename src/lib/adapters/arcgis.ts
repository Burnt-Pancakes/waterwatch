/**
 * Tiny helper for adapters that consume ArcGIS Feature/Map Server
 * `f=geojson` endpoints. They all return a standard GeoJSON
 * FeatureCollection with point geometry plus an attributes blob in
 * `properties` — we normalize that here.
 */

export type ArcGisFeature = {
  type: "Feature";
  geometry:
    | { type: "Point"; coordinates: [number, number] }
    | { type: string; coordinates: unknown }
    | null;
  properties: Record<string, unknown> | null;
};

export type ArcGisFeatureCollection = {
  type?: "FeatureCollection";
  features?: ArcGisFeature[];
};

/** Extract lng/lat from a feature, preferring geometry then properties X/Y. */
export function featureCoords(f: ArcGisFeature): { lat: number; lng: number } | null {
  if (f.geometry && f.geometry.type === "Point") {
    const [lng, lat] = (f.geometry as { coordinates: [number, number] }).coordinates;
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  const props = f.properties ?? {};
  const x = props.X ?? props.x ?? props.LONGITUDE ?? props.longitude;
  const y = props.Y ?? props.y ?? props.LATITUDE ?? props.latitude;
  if (typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)) {
    return { lat: y, lng: x };
  }
  return null;
}

/** Default fetcher used by adapters; tests inject their own. */
export async function fetchArcGisGeoJson(url: string): Promise<ArcGisFeatureCollection> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`ArcGIS ${res.status} ${res.statusText} for ${url}`);
  return (await res.json()) as ArcGisFeatureCollection;
}
