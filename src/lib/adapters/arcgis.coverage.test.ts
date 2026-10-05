/**
 * Additional coverage for arcgis.ts — fetchArcGisGeoJson and featureCoords
 * edge cases not covered elsewhere.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchArcGisGeoJson, featureCoords } from "./arcgis";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ── fetchArcGisGeoJson ────────────────────────────────────────────────────────
describe("fetchArcGisGeoJson", () => {
  it("returns parsed JSON when the response is 200 OK", async () => {
    const payload = { type: "FeatureCollection", features: [] };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => payload,
    });

    const result = await fetchArcGisGeoJson("https://example.com/query");

    expect(result).toEqual(payload);
    expect(mockFetch).toHaveBeenCalledWith("https://example.com/query", {
      headers: { Accept: "application/json" },
    });
  });

  it("throws with status and url when the response is not ok", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });

    await expect(fetchArcGisGeoJson("https://example.com/bad")).rejects.toThrow(
      "ArcGIS 503 Service Unavailable",
    );
  });
});

// ── featureCoords — edge cases ────────────────────────────────────────────────
describe("featureCoords — edge cases", () => {
  it("returns null when geometry is not a Point type", () => {
    expect(
      featureCoords({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [] },
        properties: {},
      }),
    ).toBeNull();
  });

  it("returns null when Point coordinates contain non-finite numbers", () => {
    expect(
      featureCoords({
        type: "Feature",
        geometry: { type: "Point", coordinates: [NaN, Infinity] },
        properties: {},
      }),
    ).toBeNull();
  });

  it("returns coords from LONGITUDE/LATITUDE property keys when geometry is null", () => {
    const result = featureCoords({
      type: "Feature",
      geometry: null,
      properties: { LONGITUDE: -77.05, LATITUDE: 38.85 },
    });
    expect(result).toEqual({ lat: 38.85, lng: -77.05 });
  });

  it("returns coords from lowercase longitude/latitude keys", () => {
    const result = featureCoords({
      type: "Feature",
      geometry: null,
      properties: { longitude: -77.1, latitude: 38.9 },
    });
    expect(result).toEqual({ lat: 38.9, lng: -77.1 });
  });

  it("returns null when properties is null and geometry is absent", () => {
    expect(featureCoords({ type: "Feature", geometry: null, properties: null })).toBeNull();
  });

  it("returns null when X/Y are not finite numbers", () => {
    expect(
      featureCoords({
        type: "Feature",
        geometry: null,
        properties: { X: "not-a-number", Y: 38.9 },
      }),
    ).toBeNull();
  });
});
