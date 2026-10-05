import { describe, expect, it } from "vitest";
import { filterSitesByType, FILTER_OPTIONS, type SiteTypeFilter } from "./filterSites";

const make = (site_type: string) => ({ properties: { site_type } });

const ALL = [
  make("kayak_launch"),
  make("boat_ramp"),
  make("beach"),
  make("swim_area"),
  make("fishing_access"),
  make("marina"),
  make("kayak_launch"),
];

describe("filterSitesByType", () => {
  it("'all' returns every site untouched", () => {
    expect(filterSitesByType(ALL, "all")).toEqual(ALL);
  });

  it.each(FILTER_OPTIONS.filter((o) => o.value !== "all").map((o) => o.value))(
    "filter %s only includes matching site_type",
    (filter: SiteTypeFilter) => {
      const out = filterSitesByType(ALL, filter);
      expect(out.length).toBeGreaterThan(0);
      for (const s of out) expect(s.properties.site_type).toBe(filter);
    },
  );

  it("returns an empty array when nothing matches", () => {
    const only = [make("marina")];
    expect(filterSitesByType(only, "kayak_launch")).toEqual([]);
  });
});
