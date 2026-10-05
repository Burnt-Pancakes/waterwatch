/**
 * Additional coverage for osmPoiAdapter — fetchReadings, normalize, and
 * osmTagsToSiteType branches not covered by the primary test file.
 */
import { describe, expect, it, vi } from "vitest";
import { OsmPoiAdapter, osmTagsToSiteType } from "./osmPoiAdapter";

// ── osmTagsToSiteType — missing branches ──────────────────────────────────────
describe("osmTagsToSiteType — additional tag mappings", () => {
  it("maps sport=kayak to kayak_launch", () => {
    expect(osmTagsToSiteType({ sport: "kayak" })).toBe("kayak_launch");
  });

  it("maps sport=swimming to swim_area", () => {
    expect(osmTagsToSiteType({ sport: "swimming" })).toBe("swim_area");
  });

  it("returns null when tags is undefined", () => {
    expect(osmTagsToSiteType(undefined)).toBeNull();
  });

  it("returns null when tags has no recognized key", () => {
    expect(osmTagsToSiteType({ amenity: "cafe" })).toBeNull();
  });
});

// ── OsmPoiAdapter — trivial methods ──────────────────────────────────────────
describe("OsmPoiAdapter — fetchReadings and normalize", () => {
  const adapter = new OsmPoiAdapter({} as never, vi.fn(), () => new Date());

  it("fetchReadings returns an empty array", async () => {
    expect(await adapter.fetchReadings()).toEqual([]);
  });

  it("normalize returns a blank AdapterReading skeleton", () => {
    const r = adapter.normalize({ some: "data" });
    expect(r.externalSiteId).toBe("");
    expect(r.eColiMpn).toBeNull();
    expect(r.enterococciCce).toBeNull();
    expect(r.rawPayload).toEqual({ some: "data" });
  });
});

// ── OsmPoiAdapter.fetchSites — element filtering edge cases ──────────────────
describe("OsmPoiAdapter.fetchSites — element filtering", () => {
  function makeMockSupabase() {
    const upsertSpy = vi.fn(async () => ({ error: null }));
    const fromMock = vi.fn(() => ({
      select: () => ({ in: async () => ({ data: [], error: null }) }),
      upsert: upsertSpy,
    }));
    return { supabase: { from: fromMock } as never, upsertSpy };
  }

  it("skips elements with no recognized siteType", async () => {
    const { supabase, upsertSpy } = makeMockSupabase();
    const fetchImpl = vi.fn(async () => ({
      elements: [{ type: "node", id: 1, lat: 38.85, lon: -77.05, tags: { amenity: "cafe" } }],
    }));

    const adapter = new OsmPoiAdapter(supabase, fetchImpl);
    const sites = await adapter.fetchSites();

    expect(sites).toHaveLength(0);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("skips elements that have no name tag", async () => {
    const { supabase, upsertSpy } = makeMockSupabase();
    const fetchImpl = vi.fn(async () => ({
      elements: [{ type: "node", id: 2, lat: 38.85, lon: -77.05, tags: { amenity: "boat_ramp" } }],
    }));

    const adapter = new OsmPoiAdapter(supabase, fetchImpl);
    const sites = await adapter.fetchSites();

    expect(sites).toHaveLength(0);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("uses center coords for way elements that have no direct lat/lon", async () => {
    const { supabase } = makeMockSupabase();
    const fetchImpl = vi.fn(async () => ({
      elements: [
        {
          type: "way",
          id: 3,
          // no lat/lon — only center
          center: { lat: 38.9, lon: -77.1 },
          tags: { leisure: "marina", name: "Central Marina" },
        },
      ],
    }));

    const adapter = new OsmPoiAdapter(supabase, fetchImpl);
    const sites = await adapter.fetchSites();

    expect(sites).toHaveLength(1);
    expect(sites[0].lat).toBe(38.9);
    expect(sites[0].lng).toBe(-77.1);
    expect(sites[0].name).toBe("Central Marina");
  });

  it("skips elements with no usable coordinates", async () => {
    const { supabase, upsertSpy } = makeMockSupabase();
    const fetchImpl = vi.fn(async () => ({
      elements: [
        {
          type: "way",
          id: 4,
          // no lat/lon, no center
          tags: { amenity: "boat_ramp", name: "Ghost Ramp" },
        },
      ],
    }));

    const adapter = new OsmPoiAdapter(supabase, fetchImpl);
    const sites = await adapter.fetchSites();

    expect(sites).toHaveLength(0);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("handles an empty elements array without error", async () => {
    const { supabase } = makeMockSupabase();
    const fetchImpl = vi.fn(async () => ({ elements: [] }));

    const adapter = new OsmPoiAdapter(supabase, fetchImpl);
    const sites = await adapter.fetchSites();

    expect(sites).toHaveLength(0);
  });
});
