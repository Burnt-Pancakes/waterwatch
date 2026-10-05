import type { NettleBand } from "./types";

/**
 * Sea nettle probability bands and the staleness rule for the map layer.
 *
 * This is a forecast-probability display band, not a water-quality safety
 * classification: it must never be confused with waterQualityEngine.ts's
 * pass/caution/unsafe vocabulary, and its colors are deliberately a distinct
 * neutral-to-warm ramp, not the red/green used for bacteria status
 * (see src/components/map/siteMarkerConstants.ts).
 */

/** A reading older than this, relative to now, is shown as "stale" in the popup. */
export const NETTLE_STALE_HOURS = 6;

/**
 * Band edges are inclusive on the lower bound: <25, 25-50, 50-75, >=75.
 * (i.e. exactly 25 is "moderate", exactly 50 is "high", exactly 75 is "very_high".)
 */
export function classifyNettleBand(probabilityPct: number): NettleBand {
  if (probabilityPct >= 75) return "very_high";
  if (probabilityPct >= 50) return "high";
  if (probabilityPct >= 25) return "moderate";
  return "low";
}

// Neutral-to-warm ramp: slate -> yellow -> orange -> burnt orange. Deliberately
// stays out of the green/red hues siteMarkerConstants.ts uses for pass/unsafe.
export const NETTLE_BAND_COLORS: Record<NettleBand, string> = {
  low: "#94a3b8",
  moderate: "#eab308",
  high: "#f97316",
  very_high: "#b45309",
};

export const NETTLE_BAND_LABELS: Record<NettleBand, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  very_high: "Very high",
};

/**
 * True when `observedAtIso` is more than {@link NETTLE_STALE_HOURS} old
 * relative to `now` (defaults to the current time). An unparseable timestamp
 * is treated as stale - we never want to present unparseable data as fresh.
 */
export function isNettleObservationStale(observedAtIso: string, now: Date = new Date()): boolean {
  const observedMs = Date.parse(observedAtIso);
  if (Number.isNaN(observedMs)) return true;
  const ageHours = (now.getTime() - observedMs) / 3_600_000;
  return ageHours > NETTLE_STALE_HOURS;
}
