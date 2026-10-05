import { describe, expect, it } from "vitest";
import { shouldFireAlert, computeStatus } from "./alertTrigger";

describe("shouldFireAlert", () => {
  it("returns true when new status is in triggerOn and status changed", () => {
    expect(shouldFireAlert(["caution", "unsafe"], "pass", "caution")).toBe(true);
  });

  it("returns false when new status is NOT in triggerOn", () => {
    expect(shouldFireAlert(["unsafe"], "pass", "caution")).toBe(false);
  });

  it("returns false when oldStatus equals newStatus (no change)", () => {
    expect(shouldFireAlert(["caution", "unsafe"], "caution", "caution")).toBe(false);
  });

  it("returns false with empty triggerOn", () => {
    expect(shouldFireAlert([], "pass", "unsafe")).toBe(false);
  });
});

describe("computeStatus", () => {
  it("returns 'unsafe' for E. coli above the caution threshold in freshwater", () => {
    expect(computeStatus(500, null, "freshwater")).toBe("unsafe");
  });

  it("returns 'pass' for low E. coli in freshwater", () => {
    expect(computeStatus(100, null, "freshwater")).toBe("pass");
  });

  it("returns 'caution' for E. coli between pass and unsafe thresholds", () => {
    expect(computeStatus(300, null, "freshwater")).toBe("caution");
  });

  it("returns 'no_data' when both values are null", () => {
    expect(computeStatus(null, null, "freshwater")).toBe("no_data");
  });
});
