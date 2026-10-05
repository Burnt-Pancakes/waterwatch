/**
 * Every user-facing string for the jellyfish module.
 *
 * Copy rules:
 *  - Always state this is an estimate from water temperature and salinity,
 *    never a count or sighting report.
 *  - Never borrow bacteria-safety language ("safe", "pass", "unsafe") -
 *    this is a forecast probability, not a water-quality classification.
 *  - Always show observed time, and flag staleness explicitly.
 */

export const TOGGLE_LABEL = "Jellyfish";

/** Confirmation shown when the buoy layer is switched on. */
export const TOAST = {
  showing: "Showing Jellyfish",
};

export const POPUP = {
  headline: (probabilityPct: number) => `Jellyfish: ${Math.round(probabilityPct)}% chance`,
  disclaimer:
    "Estimated from measured water temperature and salinity at this buoy (NOAA CBIBS). Not a count of jellyfish.",
  staleLabel: "stale",
};
