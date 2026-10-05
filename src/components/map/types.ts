import type { SiteStatus, SiteType } from "./SiteMarker";

/**
 * GeoJSON feature shape returned by `/api/sites` and rendered as markers.
 */
export type SiteFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    id: string;
    slug: string;
    name: string;
    site_type: SiteType;
    water_body_type: "freshwater" | "tidal_brackish";
    ada_accessible: boolean;
    description: string | null;
    address: string | null;
    status: SiteStatus;
    stale: boolean;
    sampled_at: string | null;
    owner_id: string | null;
  };
};

export type SitesFeatureCollection = {
  type: "FeatureCollection";
  features: SiteFeature[];
};
