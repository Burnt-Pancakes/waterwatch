import { describe, expect, it, vi } from "vitest";
import { NoaaRainAdapter, sumLast48h, sumLast24h, metricToInches } from "./noaaRainAdapter";

describe("metricToInches", () => {
  it("converts mm", () => expect(metricToInches(25.4, "wmoUnit:mm")).toBeCloseTo(1, 5));
  it("passes through unknown units", () => expect(metricToInches(2, "in")).toBe(2));
});

function fakeCollection(precip: number[]): { features: unknown[] } {
  const now = Date.now();
  return {
    features: precip.map((value, i) => ({
      properties: {
        timestamp: new Date(now - i * 6 * 3600_000).toISOString(),
        precipitationLast6Hours: { value, unitCode: "wmoUnit:mm" },
      },
    })),
  };
}

describe("sumLast48h", () => {
  it("sums values within window", () => {
    const total = sumLast48h(fakeCollection([25.4, 25.4]) as never, new Date());
    expect(total).toBeCloseTo(2, 5);
  });
  it("ignores values outside window", () => {
    const old = {
      features: [
        {
          properties: {
            timestamp: new Date(Date.now() - 72 * 3600_000).toISOString(),
            precipitationLast6Hours: { value: 100, unitCode: "wmoUnit:mm" },
          },
        },
      ],
    };
    expect(sumLast48h(old as never, new Date())).toBe(0);
  });
});

function makeSupabase(insertSpy: ReturnType<typeof vi.fn>) {
  return { from: () => ({ insert: insertSpy }) };
}

describe("sumLast24h", () => {
  it("sums values within 24h window", () => {
    // fakeCollection([25.4]) → one observation at now-0h: 25.4 mm = 1 inch
    const total = sumLast24h(fakeCollection([25.4]) as never, new Date());
    expect(total).toBeCloseTo(1, 5);
  });
  it("ignores values older than 24h", () => {
    const old = {
      features: [
        {
          properties: {
            timestamp: new Date(Date.now() - 30 * 3600_000).toISOString(),
            precipitationLast6Hours: { value: 100, unitCode: "wmoUnit:mm" },
          },
        },
      ],
    };
    expect(sumLast24h(old as never, new Date())).toBe(0);
  });
});

describe("NoaaRainAdapter advisory threshold", () => {
  it("0.99 inches -> advisory false", async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    const fetchImpl = vi.fn(async () => fakeCollection([25.146]));
    const adapter = new NoaaRainAdapter(makeSupabase(insertSpy) as never, fetchImpl);
    await adapter.fetchReadings("*", new Date());
    const row = insertSpy.mock.calls[0][0];
    expect(row.advisory_active).toBe(false);
    expect(row.precipitation_inches_48h).toBeCloseTo(0.99, 2);
  });
  it("1.0 inches -> advisory true (boundary)", async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    const fetchImpl = vi.fn(async () => fakeCollection([25.4]));
    const adapter = new NoaaRainAdapter(makeSupabase(insertSpy) as never, fetchImpl);
    await adapter.fetchReadings("*", new Date());
    expect(insertSpy.mock.calls[0][0].advisory_active).toBe(true);
  });
  it("writes precipitation_inches_24h to insert row", async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    // fakeCollection([25.4]) → single observation at now-0h (within 24h): 1 inch
    const fetchImpl = vi.fn(async () => fakeCollection([25.4]));
    const adapter = new NoaaRainAdapter(makeSupabase(insertSpy) as never, fetchImpl);
    await adapter.fetchReadings("*", new Date());
    const row = insertSpy.mock.calls[0][0];
    expect(row.precipitation_inches_24h).toBeCloseTo(1, 5);
  });
});
