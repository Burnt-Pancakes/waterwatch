import { describe, expect, it } from "vitest";
import { mapVaDwrFeature, vaWaterBodyType, VA_DWR_BOATING_URL } from "./virginiaDWRAdapter";

describe("VA_DWR_BOATING_URL", () => {
  it("uses the DWR hosted FeatureServer with the NoVa envelope", () => {
    expect(VA_DWR_BOATING_URL).toContain("DWR_Boating_Access/FeatureServer/0/query");
    expect(VA_DWR_BOATING_URL).toContain("geometry=-77.5,38.7,-77.0,39.0");
  });
});

describe("vaWaterBodyType", () => {
  it("classifies riverside Alexandria as tidal_brackish", () => {
    expect(vaWaterBodyType(38.83, -77.04)).toBe("tidal_brackish");
  });
  it("classifies inland NoVa as freshwater", () => {
    expect(vaWaterBodyType(38.85, -77.4)).toBe("freshwater");
  });
});

describe("mapVaDwrFeature", () => {
  it("defaults DWR sites to boat_ramp", () => {
    const site = mapVaDwrFeature({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-77.04, 38.83] },
      properties: { SITE_NAME: "Belle Haven Marina", OBJECTID: 11 },
    });
    expect(site).toMatchObject({
      externalId: "vadwr:site:11",
      siteType: "boat_ramp",
      waterBodyType: "tidal_brackish",
    });
  });
});
