import { describe, expect, it } from "vitest";
import { mapDcMarinaFeature, OPEN_DATA_DC_MARINAS_URL } from "./openDataDCAdapter";

describe("OPEN_DATA_DC_MARINAS_URL", () => {
  it("targets MapServer layer 6 with the DMV envelope", () => {
    expect(OPEN_DATA_DC_MARINAS_URL).toContain("MapServer/6/query");
    expect(OPEN_DATA_DC_MARINAS_URL).toContain("geometry=-77.12,38.80,-76.91,38.99");
    expect(OPEN_DATA_DC_MARINAS_URL).toContain("f=geojson");
  });
});

describe("mapDcMarinaFeature", () => {
  it("maps a feature with geometry to a tidal_brackish marina", () => {
    const site = mapDcMarinaFeature({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-77.04, 38.86] },
      properties: { NAME: "Capital Yacht Club", OBJECTID: 42 },
    });
    expect(site).toMatchObject({
      externalId: "opendatadc:marina:42",
      name: "Capital Yacht Club",
      lat: 38.86,
      lng: -77.04,
      siteType: "marina",
      waterBodyType: "tidal_brackish",
    });
  });

  it("falls back to X/Y in properties when geometry is missing", () => {
    const site = mapDcMarinaFeature({
      type: "Feature",
      geometry: null,
      properties: { NAME: "Diamond Teague", X: -77.005, Y: 38.875, OBJECTID: 7 },
    });
    expect(site?.lat).toBe(38.875);
    expect(site?.lng).toBe(-77.005);
  });

  it("returns null when name is missing", () => {
    expect(
      mapDcMarinaFeature({
        type: "Feature",
        geometry: { type: "Point", coordinates: [-77, 38] },
        properties: {},
      }),
    ).toBeNull();
  });
});
