import { describe, it, expect } from "vitest";
import { classifyNettleBand, isNettleObservationStale, NETTLE_STALE_HOURS } from "./thresholds";

describe("classifyNettleBand", () => {
  it("maps 0% to low", () => {
    expect(classifyNettleBand(0)).toBe("low");
  });
  it("maps 24% to low (just under the moderate boundary)", () => {
    expect(classifyNettleBand(24)).toBe("low");
  });
  it("maps 25% to moderate (lower bound is inclusive)", () => {
    expect(classifyNettleBand(25)).toBe("moderate");
  });
  it("maps 49% to moderate (just under the high boundary)", () => {
    expect(classifyNettleBand(49)).toBe("moderate");
  });
  it("maps 50% to high (lower bound is inclusive)", () => {
    expect(classifyNettleBand(50)).toBe("high");
  });
  it("maps 74% to high (just under the very_high boundary)", () => {
    expect(classifyNettleBand(74)).toBe("high");
  });
  it("maps 75% to very_high (lower bound is inclusive)", () => {
    expect(classifyNettleBand(75)).toBe("very_high");
  });
  it("maps 100% to very_high", () => {
    expect(classifyNettleBand(100)).toBe("very_high");
  });
});

describe("isNettleObservationStale", () => {
  const now = new Date("2026-09-22T12:00:00Z");

  it("is not stale exactly at the boundary minus a second", () => {
    const observedAt = new Date(now.getTime() - (NETTLE_STALE_HOURS * 3_600_000 - 1000));
    expect(isNettleObservationStale(observedAt.toISOString(), now)).toBe(false);
  });

  it("is stale exactly at the boundary plus a second", () => {
    const observedAt = new Date(now.getTime() - (NETTLE_STALE_HOURS * 3_600_000 + 1000));
    expect(isNettleObservationStale(observedAt.toISOString(), now)).toBe(true);
  });

  it("is not stale for a fresh reading", () => {
    const observedAt = new Date(now.getTime() - 30 * 60_000); // 30 minutes ago
    expect(isNettleObservationStale(observedAt.toISOString(), now)).toBe(false);
  });

  it("is stale for a reading well past the window", () => {
    const observedAt = new Date(now.getTime() - 24 * 3_600_000); // 24 hours ago
    expect(isNettleObservationStale(observedAt.toISOString(), now)).toBe(true);
  });

  it("treats an unparseable timestamp as stale", () => {
    expect(isNettleObservationStale("not-a-date", now)).toBe(true);
  });
});
