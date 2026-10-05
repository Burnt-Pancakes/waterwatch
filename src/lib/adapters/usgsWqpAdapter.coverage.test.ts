/**
 * Additional coverage for usgsWqpAdapter — fetchSites, default fetchJson,
 * and the flatten helper's non-array/non-object branch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsgsWqpAdapter } from "./usgsWqpAdapter";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ── fetchSites ────────────────────────────────────────────────────────────────
describe("UsgsWqpAdapter.fetchSites", () => {
  it("returns an empty array (WQP sites are seeded from OSM, not fetched)", async () => {
    const adapter = new UsgsWqpAdapter();
    expect(await adapter.fetchSites()).toEqual([]);
  });
});

// ── default fetchJson (used when no fetchImpl is injected) ────────────────────
describe("UsgsWqpAdapter — default fetchJson via fetchReadings", () => {
  it("resolves with parsed JSON when the WQP endpoint returns 200", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    });

    const adapter = new UsgsWqpAdapter(); // uses internal fetchJson
    const result = await adapter.fetchReadings("*", new Date("2026-01-01"));

    expect(result).toEqual([]);
    expect(mockFetch).toHaveBeenCalled();
    // Both E. coli and Enterococcus URLs are fetched.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws when the WQP endpoint returns a non-2xx status", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });

    const adapter = new UsgsWqpAdapter();

    await expect(adapter.fetchReadings("*", new Date("2026-01-01"))).rejects.toThrow(
      "USGS WQP 503 Service Unavailable",
    );
  });
});

// ── flatten — non-array, non-object payload ───────────────────────────────────
describe("UsgsWqpAdapter — flatten with unusual payload shapes", () => {
  it("handles a bare array payload (historical WQP format)", async () => {
    const row = {
      MonitoringLocationIdentifier: "USGS-X",
      ActivityStartDate: "2026-01-01",
      CharacteristicName: "E. coli",
      ResultMeasureValue: 100,
    };
    const fetchImpl = vi.fn().mockResolvedValue([row]);

    const adapter = new UsgsWqpAdapter(fetchImpl);
    const readings = await adapter.fetchReadings("*", new Date("2025-01-01"));

    expect(readings).toHaveLength(2); // 1 ecoli + 1 entero (same row fetched twice by fetchImpl mock)
    expect(readings[0].eColiMpn).toBe(100);
  });

  it("returns empty array when payload is null (non-array, non-object fallback)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(null);

    const adapter = new UsgsWqpAdapter(fetchImpl);
    const readings = await adapter.fetchReadings("*", new Date("2025-01-01"));

    expect(readings).toEqual([]);
  });

  it("returns empty array when payload.results is not an array", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ results: "not-an-array" });

    const adapter = new UsgsWqpAdapter(fetchImpl);
    const readings = await adapter.fetchReadings("*", new Date("2025-01-01"));

    expect(readings).toEqual([]);
  });

  it("handles a numeric payload (falls through to empty array)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(42);

    const adapter = new UsgsWqpAdapter(fetchImpl);
    const readings = await adapter.fetchReadings("*", new Date("2025-01-01"));

    expect(readings).toEqual([]);
  });
});

// ── normalize — unknown characteristic ────────────────────────────────────────
describe("UsgsWqpAdapter.normalize — unknown characteristic", () => {
  it("returns null for both eColiMpn and enterococciCce when characteristic is unknown", () => {
    const adapter = new UsgsWqpAdapter(vi.fn());
    const r = adapter.normalize({
      MonitoringLocationIdentifier: "USGS-Z",
      ActivityStartDate: "2026-01-01",
      CharacteristicName: "Turbidity",
      ResultMeasureValue: 5,
    });
    expect(r.eColiMpn).toBeNull();
    expect(r.enterococciCce).toBeNull();
    expect(r.externalSiteId).toBe("USGS-Z");
  });

  it("handles a completely empty raw object", () => {
    const adapter = new UsgsWqpAdapter(vi.fn());
    const r = adapter.normalize({});
    expect(r.externalSiteId).toBe("");
    expect(r.eColiMpn).toBeNull();
    expect(r.enterococciCce).toBeNull();
    expect(r.sampleMethod).toBeNull();
  });

  it("handles null raw input", () => {
    const adapter = new UsgsWqpAdapter(vi.fn());
    const r = adapter.normalize(null);
    expect(r.externalSiteId).toBe("");
  });
});
