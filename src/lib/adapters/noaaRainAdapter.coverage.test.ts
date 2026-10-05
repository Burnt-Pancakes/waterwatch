/**
 * Additional coverage for noaaRainAdapter — error paths and trivial methods
 * not covered by the primary test file.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoaaRainAdapter, sumLast48h, metricToInches } from "./noaaRainAdapter";

// ── metricToInches — missing unit branches ────────────────────────────────────
describe("metricToInches — unit code branches", () => {
  it("converts meters (:m suffix) to inches", () => {
    expect(metricToInches(0.0254, "wmoUnit:m")).toBeCloseTo(1.0, 5);
  });

  it("converts bare 'mm' suffix to inches", () => {
    expect(metricToInches(25.4, "mm")).toBeCloseTo(1.0, 5);
  });

  it("converts bare 'm' suffix to inches", () => {
    expect(metricToInches(0.0254, "m")).toBeCloseTo(1.0, 5);
  });

  it("passes through value as-is when unitCode is undefined", () => {
    expect(metricToInches(5, undefined)).toBe(5);
  });
});

// ── sumLast48h — null / missing precipitation ─────────────────────────────────
describe("sumLast48h — null and missing precipitation", () => {
  it("skips features where precipitation value is null", () => {
    const now = new Date();
    const col = {
      features: [
        {
          properties: {
            timestamp: now.toISOString(),
            precipitationLast6Hours: { value: null, unitCode: "wmoUnit:mm" },
          },
        },
      ],
    };
    expect(sumLast48h(col as never, now)).toBe(0);
  });

  it("skips features where precipitationLast6Hours is absent", () => {
    const now = new Date();
    const col = {
      features: [
        {
          properties: {
            timestamp: now.toISOString(),
            // no precipitationLast6Hours key
          },
        },
      ],
    };
    expect(sumLast48h(col as never, now)).toBe(0);
  });

  it("skips features with unparseable timestamp (NaN)", () => {
    const now = new Date();
    const col = {
      features: [
        {
          properties: {
            timestamp: "not-a-date",
            precipitationLast6Hours: { value: 100, unitCode: "wmoUnit:mm" },
          },
        },
      ],
    };
    expect(sumLast48h(col as never, now)).toBe(0);
  });

  it("handles an empty features array", () => {
    expect(sumLast48h({ features: [] }, new Date())).toBe(0);
  });

  it("handles a missing features property", () => {
    expect(sumLast48h({} as never, new Date())).toBe(0);
  });
});

// ── NoaaRainAdapter — trivial methods ─────────────────────────────────────────
describe("NoaaRainAdapter — fetchSites and normalize", () => {
  const adapter = new NoaaRainAdapter({} as never, vi.fn(), () => new Date());

  it("fetchSites returns an empty array", async () => {
    expect(await adapter.fetchSites()).toEqual([]);
  });

  it("normalize returns a blank AdapterReading skeleton", () => {
    const r = adapter.normalize({ raw: true });
    expect(r.externalSiteId).toBe("");
    expect(r.eColiMpn).toBeNull();
    expect(r.enterococciCce).toBeNull();
    expect(r.rawPayload).toEqual({ raw: true });
  });
});

// ── NoaaRainAdapter — default fetchJson via mocked global fetch ───────────────
describe("NoaaRainAdapter — default fetchJson (global fetch mock)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("succeeds when all NWS stations return 200", async () => {
    const now = new Date();
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    const supabase = { from: () => ({ insert: insertSpy }) };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [
            {
              properties: {
                timestamp: now.toISOString(),
                precipitationLast6Hours: { value: 0, unitCode: "wmoUnit:mm" },
              },
            },
          ],
        }),
      }),
    );

    // Create adapter with NO custom fetchImpl → uses internal fetchJson.
    const adapter = new NoaaRainAdapter(supabase as never, undefined, () => now);
    const result = await adapter.fetchReadings("*", now);

    expect(result).toEqual([]);
    expect(insertSpy).toHaveBeenCalledOnce();
  });

  it("throws when a NWS station returns a non-2xx status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: "Service Unavailable" }),
    );

    const adapter = new NoaaRainAdapter({} as never);

    await expect(adapter.fetchReadings("*", new Date())).rejects.toThrow(
      "NOAA: all reference stations failed",
    );
  });
});

// ── NoaaRainAdapter.fetchReadings — error paths ────────────────────────────────
describe("NoaaRainAdapter.fetchReadings — error paths", () => {
  function makeFromChain(insertSpy: ReturnType<typeof vi.fn>) {
    return { from: () => ({ insert: insertSpy }) };
  }

  it("skips a failed station and averages the remaining two", async () => {
    const now = new Date();
    const insertSpy = vi.fn().mockResolvedValue({ error: null });

    // Station 1 (KDCA) fails, stations 2 & 3 succeed with ~25.4mm each.
    let callCount = 0;
    const fetchImpl = vi.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error("KDCA down");
      return {
        features: [
          {
            properties: {
              timestamp: now.toISOString(),
              precipitationLast6Hours: { value: 25.4, unitCode: "wmoUnit:mm" },
            },
          },
        ],
      };
    });

    const adapter = new NoaaRainAdapter(makeFromChain(insertSpy) as never, fetchImpl, () => now);
    const result = await adapter.fetchReadings("*", now);

    expect(result).toEqual([]);
    // Advisory: average of 2 stations is 1 inch → advisory true
    expect(insertSpy.mock.calls[0][0].precipitation_inches_48h).toBeCloseTo(1.0, 2);
  });

  it("throws when all stations fail", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network error");
    });

    const adapter = new NoaaRainAdapter({} as never, fetchImpl, () => new Date());

    await expect(adapter.fetchReadings("*", new Date())).rejects.toThrow(
      "NOAA: all reference stations failed",
    );
  });

  it("throws when the Supabase insert fails", async () => {
    const now = new Date();
    const insertSpy = vi.fn().mockResolvedValue({ error: { message: "insert constraint" } });

    const fetchImpl = vi.fn(async () => ({
      features: [
        {
          properties: {
            timestamp: now.toISOString(),
            precipitationLast6Hours: { value: 0, unitCode: "wmoUnit:mm" },
          },
        },
      ],
    }));

    const adapter = new NoaaRainAdapter(makeFromChain(insertSpy) as never, fetchImpl, () => now);

    await expect(adapter.fetchReadings("*", now)).rejects.toThrow("NOAA insert failed");
  });
});
