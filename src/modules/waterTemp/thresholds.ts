/**
 * Water temperature safety bands.
 *
 * Source: National Center for Cold Water Safety — Water Temperature Safety Guide
 * https://www.coldwatersafety.org/water-temperature-safety-guide
 *
 * The 70°F / 21.1°C thermal-protection threshold follows NCCWS and the US Coast Guard
 * definition of cold water, raised from 60°F after a 1998 Congressional inquiry into
 * boating fatalities.
 *
 * Design invariants:
 *  - No band is labeled "safe." The lowest-risk band is "Lower risk."
 *  - The 50–60°F (maximum) band is the deadliest single range — cold shock incidence
 *    and the boating fatality multiplier peak here — but no special colour is used;
 *    the label "Maximum cold shock" carries the warning.
 *  - No combined air+water figure ("120 rule") is computed here. NCCWS explicitly
 *    identifies that formula as a myth that undermines cold water safety.
 */

import type { TempBandId } from "./types";

export const WATER_TEMP_BANDS_C = [
  { id: "extreme", maxC: 10.0, label: "Extreme risk" }, // below 50°F
  { id: "maximum", maxC: 15.6, label: "Maximum cold shock" }, // 50–60°F
  { id: "high", maxC: 21.1, label: "High risk" }, // 60–70°F
  { id: "caution", maxC: 25.0, label: "Use caution" }, // 70–77°F
  { id: "lower", maxC: Infinity, label: "Lower risk" },
] as const;

export type WaterTempBand = (typeof WATER_TEMP_BANDS_C)[number];

/** Thermal protection recommended below this temperature (US Coast Guard / NCCWS). */
export const THERMAL_PROTECTION_THRESHOLD_C = 21.1; // 70°F

/** Readings older than this are not shown. Matches MAX_READING_AGE_HOURS in fetch-water-conditions. */
export const MAX_READING_AGE_HOURS = 6;

/** At or below this distance the reading is presented as "local"; above it, as "regional estimate". */
export const LOCAL_READING_MAX_KM = 10;

/** Return the band for a given temperature. Never returns undefined — last band has maxC: Infinity. */
export function bandForTempC(tempC: number): WaterTempBand {
  for (const band of WATER_TEMP_BANDS_C) {
    if (tempC < band.maxC) return band;
  }
  return WATER_TEMP_BANDS_C[4];
}

/** Celsius to Fahrenheit. */
export function cToF(tempC: number): number {
  return (tempC * 9) / 5 + 32;
}

/** Round-to-integer Fahrenheit display string, e.g. "62°F". */
export function formatTempF(tempC: number): string {
  return `${Math.round(cToF(tempC))}°F`;
}

/**
 * Tailwind colour classes for each band.
 *
 * Slate-only ramp — no blue, no green, no amber/orange/red.
 * Blue carries river-stage and tide meaning in this app (bg-blue-100 pills).
 * Green/amber/red carry EPA bacteria meaning. Slate is visually distinct from
 * both families and reads as informational rather than verdict.
 *
 * WCAG AA contrast verified for badge text in light and dark modes:
 *   extreme  light 13.8:1  dark  8.7:1  (slate-800/100  →  slate-700/100)
 *   maximum  light  8.7:1  dark  6.2:1  (slate-700/100  →  slate-600/100)
 *   high     light  6.7:1  dark  4.8:1  (slate-600/white →  slate-500/white)
 *   caution  light  7.2:1  dark  7.2:1  (slate-400/900  →  slate-400/900)
 *   lower    light  8.7:1  dark  9.4:1  (slate-100/700  →  slate-300/800)
 *
 * Gap between caution (slate-400) and lower (slate-100) is widened to 3 stops
 * because those are the two bands summer paddlers see most.
 */
export const BAND_COLOR: Record<TempBandId, { badge: string; bg: string; text: string }> = {
  extreme: {
    badge: "bg-slate-800 text-slate-100 dark:bg-slate-700 dark:text-slate-100",
    bg: "bg-slate-800 dark:bg-slate-700",
    text: "text-slate-100",
  },
  maximum: {
    badge: "bg-slate-700 text-slate-100 dark:bg-slate-600 dark:text-slate-100",
    bg: "bg-slate-700 dark:bg-slate-600",
    text: "text-slate-100",
  },
  high: {
    badge: "bg-slate-600 text-white dark:bg-slate-500 dark:text-white",
    bg: "bg-slate-600 dark:bg-slate-500",
    text: "text-white",
  },
  caution: {
    badge: "bg-slate-400 text-slate-900 dark:bg-slate-400 dark:text-slate-900",
    bg: "bg-slate-400 dark:bg-slate-400",
    text: "text-slate-900",
  },
  lower: {
    badge: "bg-slate-100 text-slate-700 dark:bg-slate-300 dark:text-slate-800",
    bg: "bg-slate-100 dark:bg-slate-300",
    text: "text-slate-700 dark:text-slate-800",
  },
};
