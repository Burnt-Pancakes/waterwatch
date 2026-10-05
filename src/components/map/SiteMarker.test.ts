import { describe, expect, it } from "vitest";
import { Anchor, Fish, Kayak, Ship, SwimArea, Umbrella } from "@/components/icons";
import { SITE_TYPE_ICONS, STATUS_COLORS } from "./siteMarkerConstants";

describe("SiteMarker icon mapping", () => {
  it("maps each of the 6 site_types to the intended icon", () => {
    expect(SITE_TYPE_ICONS.kayak_launch).toBe(Kayak);
    expect(SITE_TYPE_ICONS.boat_ramp).toBe(Ship);
    expect(SITE_TYPE_ICONS.beach).toBe(Umbrella);
    expect(SITE_TYPE_ICONS.swim_area).toBe(SwimArea);
    expect(SITE_TYPE_ICONS.fishing_access).toBe(Fish);
    expect(SITE_TYPE_ICONS.marina).toBe(Anchor);
  });

  it("defines a non-empty icon for every site_type key", () => {
    for (const key of [
      "kayak_launch",
      "boat_ramp",
      "beach",
      "swim_area",
      "fishing_access",
      "marina",
    ] as const) {
      expect(SITE_TYPE_ICONS[key]).toBeDefined();
    }
  });
});

describe("SiteMarker color mapping", () => {
  it("maps each of the 4 statuses to the spec-mandated fill + border", () => {
    expect(STATUS_COLORS.pass).toMatchObject({ fill: "#3B6D11", border: "#27500A" });
    expect(STATUS_COLORS.caution).toMatchObject({ fill: "#BA7517", border: "#854F0B" });
    expect(STATUS_COLORS.unsafe).toMatchObject({ fill: "#E24B4A", border: "#A32D2D" });
    expect(STATUS_COLORS.no_data).toMatchObject({ fill: "#888780", border: "#5F5E5A" });
  });

  it("provides a lighter dark-mode fill for each contrast-sensitive status", () => {
    expect(STATUS_COLORS.pass.fillDark).toBe("#4CAF50");
    expect(STATUS_COLORS.caution.fillDark).toBe("#FFA726");
    expect(STATUS_COLORS.unsafe.fillDark).toBe("#EF5350");
  });
});
