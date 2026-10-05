import { describe, it, expect } from "vitest";
import {
  getWaterStatus,
  isStaleReading,
  shouldShowRainAdvisory,
  shouldShowRecentRainAdvisory,
  calculateGeometricMean,
  getActivityAdvisory,
  STATUS_CONFIG,
} from "./waterQualityEngine";

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();

describe("getWaterStatus — freshwater (E. coli)", () => {
  const fw = "freshwater" as const;
  const t = iso(0);
  it("100 -> pass", () => expect(getWaterStatus(100, null, fw, t).status).toBe("pass"));
  it("235 -> pass (boundary)", () => expect(getWaterStatus(235, null, fw, t).status).toBe("pass"));
  it("236 -> caution (boundary)", () =>
    expect(getWaterStatus(236, null, fw, t).status).toBe("caution"));
  it("410 -> caution (boundary)", () =>
    expect(getWaterStatus(410, null, fw, t).status).toBe("caution"));
  it("411 -> unsafe (boundary)", () =>
    expect(getWaterStatus(411, null, fw, t).status).toBe("unsafe"));
  it("500 -> unsafe", () => expect(getWaterStatus(500, null, fw, t).status).toBe("unsafe"));
});

describe("getWaterStatus — tidal/brackish (Enterococci)", () => {
  const tb = "tidal_brackish" as const;
  const t = iso(0);
  it("20 -> pass", () => expect(getWaterStatus(null, 20, tb, t).status).toBe("pass"));
  it("35 -> pass (boundary)", () => expect(getWaterStatus(null, 35, tb, t).status).toBe("pass"));
  it("36 -> caution (boundary)", () =>
    expect(getWaterStatus(null, 36, tb, t).status).toBe("caution"));
  it("130 -> caution (boundary)", () =>
    expect(getWaterStatus(null, 130, tb, t).status).toBe("caution"));
  it("131 -> unsafe (boundary)", () =>
    expect(getWaterStatus(null, 131, tb, t).status).toBe("unsafe"));
});

describe("getWaterStatus — combined / null handling", () => {
  const t = iso(0);
  it("both present -> uses more conservative (worse)", () => {
    // E. coli pass (100), Enterococci unsafe (200) at a freshwater site
    expect(getWaterStatus(100, 200, "freshwater", t).status).toBe("unsafe");
  });
  it("both present, both pass -> pass", () => {
    expect(getWaterStatus(100, 20, "tidal_brackish", t).status).toBe("pass");
  });
  it("both null -> no_data", () => {
    expect(getWaterStatus(null, null, "freshwater", t).status).toBe("no_data");
  });
});

describe("isStaleReading", () => {
  it("today -> false", () => expect(isStaleReading(iso(0))).toBe(false));
  it("6 days ago -> false", () => expect(isStaleReading(iso(6))).toBe(false));
  it("7 days ago -> true", () => expect(isStaleReading(iso(7))).toBe(true));
  it("8 days ago -> true", () => expect(isStaleReading(iso(8))).toBe(true));
  it("invalid date -> true (fail-safe)", () => expect(isStaleReading("not-a-date")).toBe(true));
});

describe("shouldShowRainAdvisory", () => {
  it("0.99 -> false", () => expect(shouldShowRainAdvisory(0.99)).toBe(false));
  it("1.0 -> true (boundary)", () => expect(shouldShowRainAdvisory(1.0)).toBe(true));
  it("1.5 -> true", () => expect(shouldShowRainAdvisory(1.5)).toBe(true));
  it("0 -> false", () => expect(shouldShowRainAdvisory(0)).toBe(false));
});

describe("shouldShowRecentRainAdvisory — freshwater (threshold 0.5 in)", () => {
  it("0.49 -> false", () => expect(shouldShowRecentRainAdvisory(0.49, false)).toBe(false));
  it("0.5 -> true (boundary)", () => expect(shouldShowRecentRainAdvisory(0.5, false)).toBe(true));
  it("1.2 -> true", () => expect(shouldShowRecentRainAdvisory(1.2, false)).toBe(true));
  it("0 -> false", () => expect(shouldShowRecentRainAdvisory(0, false)).toBe(false));
});

describe("shouldShowRecentRainAdvisory — tidal (threshold 0.25 in)", () => {
  it("0.24 -> false", () => expect(shouldShowRecentRainAdvisory(0.24, true)).toBe(false));
  it("0.25 -> true (boundary)", () => expect(shouldShowRecentRainAdvisory(0.25, true)).toBe(true));
  it("0.49 -> true (above tidal but below freshwater threshold)", () =>
    expect(shouldShowRecentRainAdvisory(0.49, true)).toBe(true));
  it("0 -> false", () => expect(shouldShowRecentRainAdvisory(0, true)).toBe(false));
});

describe("calculateGeometricMean", () => {
  it("[100,200,400,800,1600] -> 400 (geometric mean)", () => {
    const gm = calculateGeometricMean([100, 200, 400, 800, 1600]);
    expect(gm).not.toBeNull();
    expect(gm!).toBeCloseTo(400, 5);
  });
  it("4 values -> null (below EPA minimum of 5)", () => {
    expect(calculateGeometricMean([1, 2, 3, 4])).toBeNull();
  });
  it("contains 0 -> handled (no NaN, no zero collapse)", () => {
    const gm = calculateGeometricMean([0, 100, 100, 100, 100]);
    expect(gm).not.toBeNull();
    expect(Number.isNaN(gm!)).toBe(false);
    expect(gm!).toBeGreaterThan(0);
  });
  it("empty -> null", () => expect(calculateGeometricMean([])).toBeNull());
});

describe("getActivityAdvisory — language safety + coverage", () => {
  const statuses: Array<"pass" | "caution" | "unsafe"> = ["pass", "caution", "unsafe"];
  const activities = ["swimming", "kayaking", "wading", "fishing"] as const;

  for (const s of statuses) {
    for (const a of activities) {
      it(`${a} @ ${s}: never promises certainty`, () => {
        const msg = getActivityAdvisory(s, a);
        expect(typeof msg).toBe("string");
        expect(msg.length).toBeGreaterThan(20);
        expect(msg.toLowerCase()).not.toContain("will not get sick");
        expect(msg).not.toContain("100% safe");
        expect(msg.toLowerCase()).toContain("epa");
      });
    }
  }

  it("swimming @ unsafe is strongly discouraged", () => {
    expect(getActivityAdvisory("unsafe", "swimming").toLowerCase()).toMatch(/discouraged|avoid/);
  });
  it("fishing @ pass mentions low contact", () => {
    expect(getActivityAdvisory("pass", "fishing").toLowerCase()).toMatch(/minimal|low/);
  });
  it("no_data returns a fallback advisory", () => {
    const msg = getActivityAdvisory("no_data", "swimming");
    expect(msg.toLowerCase()).toContain("no current");
  });
});

describe("STATUS_CONFIG map", () => {
  it("has entries for pass, caution, unsafe, no_data", () => {
    expect(STATUS_CONFIG.pass.icon).toBe("CheckCircle");
    expect(STATUS_CONFIG.caution.icon).toBe("AlertTriangle");
    expect(STATUS_CONFIG.unsafe.icon).toBe("XCircle");
    expect(STATUS_CONFIG.no_data.icon).toBe("HelpCircle");
  });
  it("safeForSwimming only true for pass", () => {
    expect(STATUS_CONFIG.pass.safeForSwimming).toBe(true);
    expect(STATUS_CONFIG.caution.safeForSwimming).toBe(false);
    expect(STATUS_CONFIG.unsafe.safeForSwimming).toBe(false);
    expect(STATUS_CONFIG.no_data.safeForSwimming).toBe(false);
  });
});
