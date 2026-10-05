/**
 * Additional coverage for openDataDCAdapter — adapter class methods and
 * mapDcMarinaFeature edge cases not covered by the primary test file.
 */
import { describe, expect, it } from "vitest";
import { mapDcMarinaFeature, OpenDataDCAdapter } from "./openDataDCAdapter";

// ── mapDcMarinaFeature — name fallback cases ──────────────────────────────────
describe("mapDcMarinaFeature — name fallback cases", () => {
  it("falls back to lowercase 'name' when NAME is absent", () => {
    const site = mapDcMarinaFeature({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-77.04, 38.86] },
      properties: { name: "Lowercase Marina", OBJECTID: 10 },
    });
    expect(site?.name).toBe("Lowercase Marina");
    expect(site?.externalId).toBe("opendatadc:marina:10");
  });

  it("returns null when both NAME and name are absent", () => {
    expect(
      mapDcMarinaFeature({
        type: "Feature",
        geometry: { type: "Point", coordinates: [-77.04, 38.86] },
        properties: { OBJECTID: 5 },
      }),
    ).toBeNull();
  });

  it("returns null when name is blank whitespace", () => {
    expect(
      mapDcMarinaFeature({
        type: "Feature",
        geometry: { type: "Point", coordinates: [-77.04, 38.86] },
        properties: { NAME: "   " },
      }),
    ).toBeNull();
  });

  it("returns null when geometry is absent and no X/Y properties exist", () => {
    expect(
      mapDcMarinaFeature({
        type: "Feature",
        geometry: null,
        properties: { NAME: "Ghost Marina" },
      }),
    ).toBeNull();
  });

  it("returns null when properties is null", () => {
    expect(mapDcMarinaFeature({ type: "Feature", geometry: null, properties: null })).toBeNull();
  });
});

// ── mapDcMarinaFeature — OBJECTID fallback variants ───────────────────────────
describe("mapDcMarinaFeature — OBJECTID variants", () => {
  it("uses OBJECTID_1 when OBJECTID and objectid are absent", () => {
    const site = mapDcMarinaFeature({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-77.04, 38.86] },
      properties: { NAME: "Alt ID Marina", OBJECTID_1: 99 },
    });
    expect(site?.externalId).toBe("opendatadc:marina:99");
  });

  it("uses lowercase objectid when OBJECTID is absent", () => {
    const site = mapDcMarinaFeature({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-77.04, 38.86] },
      properties: { NAME: "Lower ID Marina", objectid: 55 },
    });
    expect(site?.externalId).toBe("opendatadc:marina:55");
  });

  it("generates externalId from name slug when no OBJECTID variant is present", () => {
    const site = mapDcMarinaFeature({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-77.04, 38.86] },
      properties: { NAME: "No ID Marina" },
    });
    expect(site?.externalId).toBe("opendatadc:marina:no-id-marina");
  });

  it("trims whitespace from the name", () => {
    const site = mapDcMarinaFeature({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-77.04, 38.86] },
      properties: { NAME: "  Trimmed Marina  ", OBJECTID: 3 },
    });
    expect(site?.name).toBe("Trimmed Marina");
  });
});

// ── mapDcMarinaFeature — always tidal_brackish marina ────────────────────────
describe("mapDcMarinaFeature — fixed classification", () => {
  it("always returns siteType marina", () => {
    const site = mapDcMarinaFeature({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-77.04, 38.86] },
      properties: { NAME: "Any Marina", OBJECTID: 1 },
    });
    expect(site?.siteType).toBe("marina");
  });

  it("always returns waterBodyType tidal_brackish", () => {
    const site = mapDcMarinaFeature({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-77.04, 38.86] },
      properties: { NAME: "Any Marina", OBJECTID: 1 },
    });
    expect(site?.waterBodyType).toBe("tidal_brackish");
  });
});

// ── OpenDataDCAdapter class ───────────────────────────────────────────────────
describe("OpenDataDCAdapter class", () => {
  const adapter = new OpenDataDCAdapter({} as never);

  it("fetchSites returns an empty array (adapter disabled)", async () => {
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
    expect(r.sampleMethod).toBeNull();
    expect(r.sourceUrl).toBeNull();
    expect(r.rawPayload).toEqual({ raw: true });
  });

  it("has correct sourceId and displayName", () => {
    expect(adapter.sourceId).toBe("opendatadc");
    expect(adapter.displayName).toBe("Open Data DC (Marinas)");
  });
});
