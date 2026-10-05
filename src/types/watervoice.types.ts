import type { SiteRow, ReadingRow } from "./database.types";

/**
 * Display-level water quality status.
 *
 * Differs from `readings.status` in the database by adding `stale`:
 * a reading whose `sampled_at` is too old to be considered current
 * is surfaced as `stale` in the UI even though the underlying row
 * still has `pass`/`caution`/`unsafe`.
 */
export type WaterStatus = "pass" | "caution" | "unsafe" | "stale" | "no_data";

/**
 * Visual + copy configuration for rendering a {@link WaterStatus}.
 * Centralized so every component (map pin, list row, detail header)
 * renders the same colors and messaging for a given status.
 */
export type StatusConfig = {
  status: WaterStatus;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: string;
  safeForSwimming: boolean;
  safeForKayaking: boolean;
  safeForWading: boolean;
  shortMessage: string;
  longMessage: string;
};

/**
 * Composite row used throughout the UI: a site, its most recent
 * reading (if any), the derived display status, a freshness flag,
 * and the distance from the user's current location in kilometers
 * (null when the user has not shared their location).
 */
export type SiteWithStatus = {
  site: SiteRow;
  latestReading: ReadingRow | null;
  status: WaterStatus;
  isStale: boolean;
  distanceKm: number | null;
};
