import { describe, it, expect } from "vitest";
import { distanceKm } from "./geo";

describe("distanceKm", () => {
  it("returns 0 for identical points", () => {
    expect(distanceKm(38.8583, -77.0675, 38.8583, -77.0675)).toBe(0);
  });

  it("matches the SQL formula for Four Mile Run launch -> confluence (~1.5 km)", () => {
    // From seed: launch (38.8583,-77.0675) to confluence (38.8467,-77.0567)
    const d = distanceKm(38.8583, -77.0675, 38.8467, -77.0567);
    expect(d).toBeGreaterThan(1.3);
    expect(d).toBeLessThan(1.8);
  });

  it("agrees with manual equirectangular calc for a 1-degree latitude step", () => {
    // 1 degree of latitude ~ 111.045 km
    const d = distanceKm(38.0, -77.0, 39.0, -77.0);
    expect(d).toBeCloseTo(111.045, 3);
  });

  it("is approximately symmetric (equirectangular uses origin latitude for cosine)", () => {
    const a = distanceKm(38.8583, -77.0675, 38.8474, -77.0543);
    const b = distanceKm(38.8474, -77.0543, 38.8583, -77.0675);
    // Asymmetry is bounded by O(dLat^2); at ~1.5 km it should be <1 m.
    expect(Math.abs(a - b)).toBeLessThan(0.001);
  });
});
