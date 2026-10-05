/**
 * Additional coverage for marylandDNRAdapter — edge cases not covered by
 * the primary test file.
 */
import { describe, expect, it } from "vitest";
import { classifyMdSite, mapMdSiteFeature, MarylandDNRAdapter } from "./marylandDNRAdapter";

describe("classifyMdSite — edge cases", () => {
  it("returns boat_ramp / freshwater for undefined ramp type and waterway", () => {
    expect(classifyMdSite(undefined, undefined, undefined)).toEqual({
      siteType: "boat_ramp",
      waterBodyType: "freshwater",
    });
  });

  it("classifies case-insensitive 'CARRY DOWN' as kayak_launch", () => {
    expect(classifyMdSite(undefined, "yes", "Patuxent")).toMatchObject({
      siteType: "kayak_launch",
    });
  });

  it("matches 'potomac' in any case as tidal_brackish", () => {
    expect(classifyMdSite("Ramp", undefined, "POTOMAC RIVER")).toMatchObject({
      waterBodyType: "tidal_brackish",
    });
  });

  it("does not promote non-Potomac waterways", () => {
    expect(classifyMdSite("Ramp", undefined, "Patuxent River")).toMatchObject({
      waterBodyType: "freshwater",
    });
  });
});

describe("mapMdSiteFeature — null and fallback cases", () => {
  it("returns null when properties is null", () => {
    expect(mapMdSiteFeature({ type: "Feature", geometry: null, properties: null })).toBeNull();
  });

  it("returns null when name is empty string", () => {
    expect(
      mapMdSiteFeature({
        type: "Feature",
        geometry: { type: "Point", coordinates: [-77, 39] },
        properties: { SITE_NAME: "   " },
      }),
    ).toBeNull();
  });

  it("returns null when name is missing entirely", () => {
    expect(
      mapMdSiteFeature({
        type: "Feature",
        geometry: { type: "Point", coordinates: [-77, 39] },
        properties: {},
      }),
    ).toBeNull();
  });

  it("returns null when geometry is absent and no X/Y in properties", () => {
    expect(
      mapMdSiteFeature({
        type: "Feature",
        geometry: null,
        properties: { SITE_NAME: "Mystery Site" },
      }),
    ).toBeNull();
  });

  it("prefers SiteName over SITE_NAME when both are present", () => {
    const site = mapMdSiteFeature({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-77.05, 38.95] },
      properties: {
        SiteName: "Sandy Point",
        SITE_NAME: "Old Name",
        BoatRamp: "No",
        SoftAccess: "Yes",
        WaterBody: "Bay",
      },
    });
    expect(site?.name).toBe("Sandy Point");
    expect(site?.siteType).toBe("kayak_launch");
  });

  it("falls back to SITE_NAME when SiteName is absent", () => {
    const site = mapMdSiteFeature({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-77.1, 38.8] },
      properties: { SITE_NAME: "Fallback Site", OBJECTID: 99 },
    });
    expect(site?.name).toBe("Fallback Site");
  });

  it("generates externalId from name when OBJECTID is absent", () => {
    const site = mapMdSiteFeature({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-77.1, 38.8] },
      properties: { SITE_NAME: "No ID Site" },
    });
    expect(site?.externalId).toBe("mddnr:site:no-id-site");
  });

  it("trims whitespace from the site name", () => {
    const site = mapMdSiteFeature({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-77, 39] },
      properties: { SITE_NAME: "  Trimmed  ", OBJECTID: 5 },
    });
    expect(site?.name).toBe("Trimmed");
  });
});

describe("MarylandDNRAdapter class", () => {
  const emptyFetch = () => Promise.resolve({ type: "FeatureCollection" as const, features: [] });
  const adapter = new MarylandDNRAdapter({} as never, emptyFetch);

  it("fetchSites returns empty array when API returns no features", async () => {
    expect(await adapter.fetchSites()).toEqual([]);
  });

  it("fetchReadings returns an empty array", async () => {
    expect(await adapter.fetchReadings()).toEqual([]);
  });

  it("normalize returns a blank AdapterReading skeleton", () => {
    const r = adapter.normalize({ raw: true });
    expect(r.externalSiteId).toBe("");
    expect(r.eColiMpn).toBeNull();
    expect(r.enterococciCce).toBeNull();
  });
});
