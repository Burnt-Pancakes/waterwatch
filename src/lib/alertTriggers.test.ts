import { describe, expect, it } from "vitest";
import {
  formatTriggerOn,
  wantsWeatherAdvisoryAlerts,
  WEATHER_ADVISORY_TRIGGER,
} from "./alertTriggers";

describe("alertTriggers", () => {
  it("wantsWeatherAdvisoryAlerts returns true when weather_advisory is selected", () => {
    expect(wantsWeatherAdvisoryAlerts(["caution", WEATHER_ADVISORY_TRIGGER])).toBe(true);
  });

  it("wantsWeatherAdvisoryAlerts returns false for water-quality-only triggers", () => {
    expect(wantsWeatherAdvisoryAlerts(["caution", "unsafe"])).toBe(false);
  });

  it("formatTriggerOn maps trigger keys to display names", () => {
    expect(formatTriggerOn(["caution", WEATHER_ADVISORY_TRIGGER])).toBe(
      "Caution, Weather advisories",
    );
  });

  it("formatTriggerOn falls back to the raw key for unknown trigger values", () => {
    expect(formatTriggerOn(["custom_trigger"])).toBe("custom_trigger");
  });
});
