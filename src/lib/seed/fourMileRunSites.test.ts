import { describe, it, expect } from "vitest";
import { fourMileRunSites } from "./fourMileRunSites";

describe("fourMileRunSites seed", () => {
  it("has the documented sites", () => {
    expect(fourMileRunSites).toHaveLength(17);
  });

  it("has unique slugs", () => {
    const slugs = fourMileRunSites.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("marks the ADA launch as accessible and freshwater", () => {
    const ada = fourMileRunSites.find((s) => s.slug === "four-mile-run-kayak-launch-ada");
    expect(ada?.ada_accessible).toBe(true);
    expect(ada?.water_body_type).toBe("freshwater");
    expect(ada?.site_type).toBe("kayak_launch");
  });

  it("marks the marina as tidal_brackish", () => {
    const marina = fourMileRunSites.find((s) => s.slug === "washington-sailing-marina");
    expect(marina?.water_body_type).toBe("tidal_brackish");
    expect(marina?.site_type).toBe("marina");
  });

  it("every site has a valid lat/lng within the DMV bounding box", () => {
    for (const s of fourMileRunSites) {
      expect(s.lat).toBeGreaterThan(38);
      expect(s.lat).toBeLessThan(40);
      expect(s.lng).toBeGreaterThan(-78);
      expect(s.lng).toBeLessThan(-76);
    }
  });
});
