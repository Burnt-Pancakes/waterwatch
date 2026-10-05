import { describe, expect, it } from "vitest";
import { classifyMdSite, mapMdSiteFeature, MD_DNR_BOATING_URL } from "./marylandDNRAdapter";

describe("MD_DNR_BOATING_URL", () => {
  it("targets the Public_Water_Access_2020 FeatureServer filtered to target counties", () => {
    expect(MD_DNR_BOATING_URL).toContain("Public_Water_Access_2020/FeatureServer/0/query");
    expect(MD_DNR_BOATING_URL).toContain("County+IN+");
  });
});

describe("classifyMdSite", () => {
  it("treats soft-access-only launches as kayak_launch", () => {
    expect(classifyMdSite("No", "Yes", "Patuxent River")).toEqual({
      siteType: "kayak_launch",
      waterBodyType: "freshwater",
    });
  });
  it("treats undefined BoatRamp with SoftAccess=Yes as kayak_launch", () => {
    expect(classifyMdSite(undefined, "Yes", "")).toMatchObject({ siteType: "kayak_launch" });
  });
  it("defaults to boat_ramp when BoatRamp=Yes", () => {
    expect(classifyMdSite("Yes", "No", "Anacostia")).toEqual({
      siteType: "boat_ramp",
      waterBodyType: "freshwater",
    });
  });
  it("promotes Potomac waterways to tidal_brackish", () => {
    expect(classifyMdSite("Yes", "No", "Potomac River")).toMatchObject({
      waterBodyType: "tidal_brackish",
    });
  });
});

describe("mapMdSiteFeature", () => {
  it("maps a feature using SiteName and geometry", () => {
    const site = mapMdSiteFeature({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-77.05, 38.95] },
      properties: {
        SiteName: "Fort Foote",
        BoatRamp: "Yes",
        SoftAccess: "No",
        WaterBody: "Potomac River",
        OBJECTID: 3,
      },
    });
    expect(site).toMatchObject({
      externalId: "mddnr:site:3",
      name: "Fort Foote",
      siteType: "boat_ramp",
      waterBodyType: "tidal_brackish",
    });
  });
});
