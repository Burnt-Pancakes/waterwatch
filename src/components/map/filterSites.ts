/**
 * Pure helpers for the map filter pills. Extracted so they can be unit-tested
 * without rendering MapLibre.
 */

export type SiteTypeFilter =
  | "all"
  | "kayak_launch"
  | "boat_ramp"
  | "beach"
  | "swim_area"
  | "fishing_access"
  | "marina";

export const FILTER_OPTIONS: { value: SiteTypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "kayak_launch", label: "Kayak" },
  { value: "boat_ramp", label: "Boat Ramp" },
  { value: "beach", label: "Beach" },
  { value: "swim_area", label: "Swim" },
  { value: "fishing_access", label: "Fishing" },
  { value: "marina", label: "Marina" },
];

export type SiteLike = { properties: { site_type: string } };

/**
 * Filter a list of sites/features by site type.
 * `"all"` returns the input unchanged.
 */
export function filterSitesByType<T extends SiteLike>(sites: T[], filter: SiteTypeFilter): T[] {
  if (filter === "all") return sites;
  return sites.filter((s) => s.properties.site_type === filter);
}
