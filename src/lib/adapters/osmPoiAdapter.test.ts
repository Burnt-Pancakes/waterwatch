import { describe, expect, it, vi } from "vitest";
import {
  OsmPoiAdapter,
  osmTagsToSiteType,
  slugify,
  buildOverpassQuery,
  DMV_BBOX,
} from "./osmPoiAdapter";

describe("osmTagsToSiteType", () => {
  it("maps boat_ramp", () => expect(osmTagsToSiteType({ amenity: "boat_ramp" })).toBe("boat_ramp"));
  it("maps marina", () => expect(osmTagsToSiteType({ leisure: "marina" })).toBe("marina"));
  it("maps beach", () => expect(osmTagsToSiteType({ leisure: "beach" })).toBe("beach"));
  it("maps canoe_rental", () =>
    expect(osmTagsToSiteType({ amenity: "canoe_rental" })).toBe("kayak_launch"));
  it("maps water_park", () =>
    expect(osmTagsToSiteType({ leisure: "water_park" })).toBe("swim_area"));
  it("returns null for unknown", () => expect(osmTagsToSiteType({ amenity: "school" })).toBeNull());
});

describe("slugify", () => {
  it("normalizes name", () => expect(slugify("Hains Point!", "x")).toBe("hains-point"));
  it("falls back when empty", () => expect(slugify("", "osm-1")).toBe("osm-1"));
});

describe("buildOverpassQuery", () => {
  it("contains bbox coords", () => {
    const q = buildOverpassQuery(DMV_BBOX);
    expect(q).toContain("38.7,-77.5,39.1,-76.8");
    expect(q).toContain("boat_ramp");
    expect(q).toContain('leisure"="beach');
    expect(q).toContain('amenity"="canoe_rental');
    expect(q).toContain('leisure"="water_park');
  });
});

describe("OsmPoiAdapter.fetchSites", () => {
  it("inserts new POIs and skips ones refreshed within 7 days", async () => {
    const fetchImpl = vi.fn(async () => ({
      elements: [
        {
          type: "node",
          id: 1,
          lat: 38.85,
          lon: -77.05,
          tags: { amenity: "boat_ramp", name: "Old Ramp" },
        },
        {
          type: "node",
          id: 2,
          lat: 38.86,
          lon: -77.06,
          tags: { leisure: "marina", name: "New Marina" },
        },
      ],
    }));
    const now = new Date("2026-05-20T00:00:00Z");
    // Helper does two selects: existing-by-osm_id and all-sites scan.
    const existingByOsmId = [
      {
        osm_id: "osm:node/1",
        updated_at: new Date(now.getTime() - 2 * 86400_000).toISOString(),
      },
    ];
    const upsertSpy = vi.fn(async () => ({ error: null }));
    const fromMock = vi.fn(() => ({
      select: (cols: string) => {
        if (cols.includes("updated_at")) {
          return { in: async () => ({ data: existingByOsmId, error: null }) };
        }
        // all-sites dedup scan — return empty so nothing dedups.
        return Promise.resolve({ data: [], error: null });
      },
      upsert: upsertSpy,
    }));
    const adapter = new OsmPoiAdapter({ from: fromMock } as never, fetchImpl, () => now);
    await adapter.fetchSites();
    // Only one upsert call expected: the insert of the brand-new
    // Marina row. The pre-existing Ramp was refreshed within 7 days so
    // it is skipped entirely.
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const [rows] = upsertSpy.mock.calls[0] as unknown as [Array<Record<string, unknown>>];
    expect(rows).toHaveLength(1);
    expect(rows[0].osm_id).toBe("osm:node/2");
    expect(rows[0].is_active).toBe(false);
  });
});
