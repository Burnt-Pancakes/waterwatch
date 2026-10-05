/**
 * Every user-facing string for the water temperature module.
 * Sections are ordered data, not JSX — components decide how to render them.
 *
 * Copy rules:
 *  - Never the word "safe." Warm water is not safe water.
 *  - Always show gauge distance and reading age.
 *  - Local framing (within LOCAL_READING_MAX_KM) differs from regional framing.
 *  - Explicitly state that air temperature does not offset cold water.
 *  - Advisory register, never regulatory.
 */

export interface ExplainerSection {
  readonly id: string;
  readonly heading: string;
  readonly body: string;
}

export const CARD_TITLE = "Water temperature";

export const SOURCE_LABELS: Record<string, string> = {
  usgs: "USGS",
  cbibs: "NOAA CBIBS",
};

export const DISTANCE_LABEL = {
  local: (km: number) => `${km.toFixed(1)} km away (local reading)`,
  regional: (km: number) => `${km.toFixed(1)} km away (regional estimate)`,
};

export const AGE_LABEL = (ageMinutes: number): string => {
  if (ageMinutes < 1) return "just now";
  if (ageMinutes < 60) return `${ageMinutes} min ago`;
  const hrs = Math.round(ageMinutes / 60);
  return hrs === 1 ? "1 hour ago" : `${hrs} hours ago`;
};

export const THERMAL_PROTECTION_NOTE =
  "Below 70°F — thermal protection (wetsuit or drysuit) is recommended by the " +
  "National Center for Cold Water Safety and the US Coast Guard.";

export const NO_AIR_OFFSET_NOTE =
  "Air temperature does not offset cold water. " +
  'The "120 rule" (air + water ≥ 120°F) is identified by NCCWS as a myth ' +
  "that contributes to boating fatalities.";

export const DISCLAIMER =
  "This is advisory only, not a regulatory determination. " +
  "Verify conditions before entering the water.";

// USGS's own term for unreviewed real-time sensor data; we apply it to all
// readings (CBIBS does not publish a quality flag, so "provisional" is the
// most accurate single qualifier for both sources).
export const PROVISIONAL_QUALIFIER = "provisional";

// Hoisted so WaterTempBanner can reference the same copy without importing
// the full EXPLAINER_SECTIONS array. The section entry below uses this value.
export const NO_STATION_BODY =
  "36% of monitored sites have no water temperature station within 30 km — this is " +
  "most common on the Eastern Shore and in remote Western Maryland. When no reading " +
  "is available, use seasonal context: Mid-Atlantic surface water typically runs cold " +
  "(40–55°F / 4–13°C) from November through April, rises through May and June, and " +
  "peaks in August. Bay and tidal river water runs consistently warmer than inland " +
  "creeks in the same season. Treat any immersion in spring or fall as cold-water " +
  "exposure and dress accordingly. This seasonal guidance does not substitute for " +
  "an actual measurement.";

export const EXPLAINER_SECTIONS: readonly ExplainerSection[] = [
  {
    id: "what-it-is",
    heading: "What this shows",
    body:
      "Recent water temperature from the nearest USGS gauge or NOAA CBIBS buoy, " +
      "shown to help you decide how to dress. Water temperature governs how quickly " +
      "cold shock sets in and how long you can survive an unexpected immersion — it is " +
      "the single most important factor in immersion survival.",
  },
  {
    id: "what-it-is-not",
    heading: "What it is not",
    body:
      "Not a measurement at your launch site. Temperature varies between a shaded " +
      "tributary and open river, and between surface and depth — sometimes by several " +
      "degrees. The reading shown is from the closest reporting station, which may be " +
      "kilometres away on a different reach. A spring-fed creek can run several degrees " +
      "colder than a nearby mainstem gauge suggests.",
  },
  {
    id: "how-it-works",
    heading: "How it works",
    body:
      "USGS stream gauges and NOAA CBIBS Bay buoys report water temperature " +
      "continuously. We show the most recent reading within the last 6 hours from the " +
      "station nearest to your site and tell you exactly how far away that station is.",
  },
  {
    id: "limits",
    heading: "Its limits",
    body:
      "The reading may be up to 6 hours old and kilometres away. Neither USGS nor CBIBS " +
      "reports sensor depth for these measurements, so a surface reading is assumed — not " +
      "confirmed. If you are paddling a river fed by cold groundwater or significant spring " +
      "flow, actual water temperature may be colder than shown. " +
      "These are automated sensor readings that have not been through agency review, and " +
      "values can be revised. CBIBS does not report a data-quality flag at all, so " +
      "validation status for buoy readings is unknown rather than confirmed.",
  },
  {
    id: "source",
    heading: "Where it comes from",
    body:
      "USGS Water Data APIs (waterdata.usgs.gov) and the NOAA Chesapeake Bay " +
      "Interpretive Buoy System (buoybay.noaa.gov). Readings are refreshed every hour. " +
      "Both networks report continuously and are not collected for recreational advisory " +
      "purposes — they are infrastructure sensors repurposed here.",
  },
  {
    id: "what-to-do",
    heading: "What to do with this",
    body:
      "Dress for the water, not the air. Below 70°F (21.1°C), thermal protection — a " +
      "wetsuit or drysuit — is recommended by the National Center for Cold Water Safety " +
      "and the US Coast Guard. A PFD keeps you at the surface; thermal protection buys " +
      "you the time that cold shock otherwise takes away. " +
      "Air temperature does not offset cold water. The National Center for Cold Water " +
      'Safety explicitly identifies the "120 rule" (air + water ≥ 120°F means no ' +
      "protection needed) as a myth that contributes to boating fatalities. Do not use it.",
  },
  {
    id: "no-gauge",
    heading: "When there is no nearby station",
    body: NO_STATION_BODY,
  },
] as const;
