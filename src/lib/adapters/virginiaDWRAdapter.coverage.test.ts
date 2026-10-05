/**
 * Additional coverage for virginiaDWRAdapter — adapter class methods and
 * mapVaDwrFeature edge cases not covered by the primary test file.
 */
import { describe, expect, it } from "vitest";
import { mapVaDwrFeature, vaWaterBodyType, VirginiaDWRAdapter } from "./virginiaDWRAdapter";

// ── vaWaterBodyType — boundary values ─────────────────────────────────────────
describe("vaWaterBodyType — edge cases", () => {
  it("returns tidal_brackish exactly at the -77.10 longitude boundary", () => {
    expect(vaWaterBodyType(38.85, -77.1)).toBe("tidal_brackish");
  });

  it("returns freshwater just west of the boundary (-77.11)", () => {
    expect(vaWaterBodyType(38.85, -77.11)).toBe("freshwater");
  });

  it("returns freshwater when lat is below 38.7 even if lng qualifies", () => {
    expect(vaWaterBodyType(38.6, -77.05)).toBe("freshwater");
  });

  it("returns freshwater when lat is above 39.0 even if lng qualifies", () => {
    expect(vaWaterBodyType(39.1, -77.05)).toBe("freshwater");
  });
});

// ── mapVaDwrFeature — null / missing cases ────────────────────────────────────
describe("mapVaDwrFeature — null and fallback cases", () => {
  it("returns null when name is missing entirely", () => {
    expect(
      mapVaDwrFeature({
        type: "Feature",
        geometry: { type: "Point", coordinates: [-77.04, 38.83] },
        properties: { OBJECTID: 1 },
      }),
    ).toBeNull();
  });

  it("returns null when name is blank whitespace", () => {
    expect(
      mapVaDwrFeature({
        type: "Feature",
        geometry: { type: "Point", coordinates: [-77.04, 38.83] },
        properties: { SITE_NAME: "   " },
      }),
    ).toBeNull();
  });

  it("returns null when geometry is absent and no X/Y properties exist", () => {
    expect(
      mapVaDwrFeature({
        type: "Feature",
        geometry: null,
        properties: { SITE_NAME: "Mystery Site" },
      }),
    ).toBeNull();
  });

  it("returns null when properties is null", () => {
    expect(mapVaDwrFeature({ type: "Feature", geometry: null, properties: null })).toBeNull();
  });

  it("falls back to site_name (lowercase) when SITE_NAME is absent", () => {
    const site = mapVaDwrFeature({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-77.04, 38.83] },
      properties: { site_name: "Riverside Ramp", OBJECTID: 7 },
    });
    expect(site?.name).toBe("Riverside Ramp");
    expect(site?.externalId).toBe("vadwr:site:7");
  });

  it("falls back to NAME when both SITE_NAME and site_name are absent", () => {
    const site = mapVaDwrFeature({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-77.04, 38.83] },
      properties: { NAME: "Fallback Ramp", OBJECTID: 12 },
    });
    expect(site?.name).toBe("Fallback Ramp");
  });

  it("generates externalId from name slug when OBJECTID is absent", () => {
    const site = mapVaDwrFeature({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-77.04, 38.83] },
      properties: { SITE_NAME: "Hidden Cove" },
    });
    expect(site?.externalId).toBe("vadwr:site:hidden-cove");
  });

  it("falls back to X/Y in properties when geometry is missing", () => {
    const site = mapVaDwrFeature({
      type: "Feature",
      geometry: null,
      properties: { SITE_NAME: "Coord Ramp", X: -77.05, Y: 38.85, OBJECTID: 3 },
    });
    expect(site?.lat).toBe(38.85);
    expect(site?.lng).toBe(-77.05);
  });

  it("trims whitespace from the site name", () => {
    const site = mapVaDwrFeature({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-77.04, 38.83] },
      properties: { SITE_NAME: "  Trimmed Ramp  ", OBJECTID: 20 },
    });
    expect(site?.name).toBe("Trimmed Ramp");
  });

  it("all DWR sites default to siteType boat_ramp", () => {
    const site = mapVaDwrFeature({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-77.04, 38.83] },
      properties: { SITE_NAME: "Any Ramp", OBJECTID: 5 },
    });
    expect(site?.siteType).toBe("boat_ramp");
  });
});

// ── VirginiaDWRAdapter class ───────────────────────────────────────────────────
describe("VirginiaDWRAdapter class", () => {
  const adapter = new VirginiaDWRAdapter({} as never);

  it("fetchSites returns an empty array (adapter disabled)", async () => {
    expect(await adapter.fetchSites()).toEqual([]);
  });

  it("fetchReadings returns an empty array", async () => {
    expect(await adapter.fetchReadings()).toEqual([]);
  });

  it("normalize returns a blank AdapterReading skeleton", () => {
    const r = adapter.normalize({ some: "raw" });
    expect(r.externalSiteId).toBe("");
    expect(r.eColiMpn).toBeNull();
    expect(r.enterococciCce).toBeNull();
    expect(r.sampleMethod).toBeNull();
    expect(r.sourceUrl).toBeNull();
    expect(r.rawPayload).toEqual({ some: "raw" });
  });

  it("has correct sourceId and displayName", () => {
    expect(adapter.sourceId).toBe("vadwr");
    expect(adapter.displayName).toBe("Virginia DWR Boating Access");
  });
});
