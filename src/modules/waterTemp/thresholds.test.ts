import { describe, it, expect } from "vitest";
import { WATER_TEMP_BANDS_C, bandForTempC } from "./thresholds";
import {
  CARD_TITLE,
  SOURCE_LABELS,
  DISTANCE_LABEL,
  AGE_LABEL,
  THERMAL_PROTECTION_NOTE,
  NO_AIR_OFFSET_NOTE,
  DISCLAIMER,
  NO_STATION_BODY,
  PROVISIONAL_QUALIFIER,
  EXPLAINER_SECTIONS,
} from "./content";

describe("bandForTempC", () => {
  it("maps 4°C to extreme (below 10°C / 50°F)", () => {
    expect(bandForTempC(4).id).toBe("extreme");
  });
  it("maps 12°C to maximum (10–15.6°C / 50–60°F)", () => {
    expect(bandForTempC(12).id).toBe("maximum");
  });
  it("maps 18°C to high (15.6–21.1°C / 60–70°F)", () => {
    expect(bandForTempC(18).id).toBe("high");
  });
  it("maps 23°C to caution (21.1–25°C / 70–77°F)", () => {
    expect(bandForTempC(23).id).toBe("caution");
  });
  it("maps 28°C to lower (above 25°C / 77°F)", () => {
    expect(bandForTempC(28).id).toBe("lower");
  });

  it("maps boundary 10.0°C to maximum (not extreme)", () => {
    expect(bandForTempC(10.0).id).toBe("maximum");
  });
  it("maps just below 10°C to extreme", () => {
    expect(bandForTempC(9.99).id).toBe("extreme");
  });
});

// -------------------------------------------------------------------
// "safe" assertions — band labels and all exported user-facing strings.
//
// The case-insensitive grep over this module returns hits only for
// "National Center for Cold Water Safety" (org name, used as a source
// citation) and for these assertion strings themselves. This widened
// test covers every exported user-facing value and allowlists the org
// name and its domain, resolving the 6.2 conflict.
// -------------------------------------------------------------------

const ALLOWED = /National Center for Cold Water Safety|coldwatersafety\.org/gi;

function assertNoSafe(value: string, label: string): void {
  const stripped = value.replace(ALLOWED, "");
  expect(stripped.toLowerCase(), label).not.toContain("safe");
}

describe('band labels — no label may contain "safe"', () => {
  it('no label contains the substring "safe"', () => {
    for (const band of WATER_TEMP_BANDS_C) {
      expect(band.label.toLowerCase()).not.toContain("safe");
    }
  });
});

describe('user-facing exported strings — no unallowlisted "safe"', () => {
  it("CARD_TITLE", () => assertNoSafe(CARD_TITLE, "CARD_TITLE"));
  it("DISCLAIMER", () => assertNoSafe(DISCLAIMER, "DISCLAIMER"));
  it("THERMAL_PROTECTION_NOTE", () =>
    assertNoSafe(THERMAL_PROTECTION_NOTE, "THERMAL_PROTECTION_NOTE"));
  it("NO_AIR_OFFSET_NOTE", () => assertNoSafe(NO_AIR_OFFSET_NOTE, "NO_AIR_OFFSET_NOTE"));
  it("NO_STATION_BODY", () => assertNoSafe(NO_STATION_BODY, "NO_STATION_BODY"));
  it("PROVISIONAL_QUALIFIER", () => assertNoSafe(PROVISIONAL_QUALIFIER, "PROVISIONAL_QUALIFIER"));
  it("SOURCE_LABELS values", () => {
    for (const v of Object.values(SOURCE_LABELS)) {
      assertNoSafe(v, `SOURCE_LABELS["${v}"]`);
    }
  });
  it("DISTANCE_LABEL outputs", () => {
    assertNoSafe(DISTANCE_LABEL.local(5.0), "DISTANCE_LABEL.local");
    assertNoSafe(DISTANCE_LABEL.regional(15.0), "DISTANCE_LABEL.regional");
  });
  it("AGE_LABEL outputs", () => {
    for (const minutes of [0, 30, 90, 180]) {
      assertNoSafe(AGE_LABEL(minutes), `AGE_LABEL(${minutes})`);
    }
  });
  it("EXPLAINER_SECTIONS headings and bodies", () => {
    for (const section of EXPLAINER_SECTIONS) {
      assertNoSafe(section.heading, `section["${section.id}"].heading`);
      assertNoSafe(section.body, `section["${section.id}"].body`);
    }
  });
});
