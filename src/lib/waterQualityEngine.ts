/**
 * WaterWatch DMV — Water Quality Decision Engine
 *
 * Pure, side-effect-free TypeScript module that converts raw bacteria
 * readings into display-ready status, advisories, and disclaimers.
 *
 * Standards basis:
 *   - EPA 2012 Recreational Water Quality Criteria (RWQC)
 *   - Virginia DEQ Water Quality Standards (E. coli for freshwater)
 *
 * SAFETY-CRITICAL: Every function here informs whether a member of the
 * public will enter water that may contain pathogens. Do NOT introduce
 * network calls, randomness, mutable globals, or non-deterministic logic.
 * Inputs in → outputs out, always.
 */

import type { StatusConfig, WaterStatus } from "@/types/watervoice.types";

// ---------------------------------------------------------------------------
// Thresholds — DO NOT CHANGE without citing the regulation that justifies it.
// ---------------------------------------------------------------------------

/** Freshwater E. coli single-sample "pass" ceiling (MPN/100mL). */
export const ECOLI_PASS_THRESHOLD = 235;
/** Freshwater E. coli upper limit for "caution"; above this is "unsafe". */
export const ECOLI_CAUTION_MAX = 410;

/** Marine / tidal Enterococci "pass" ceiling (CCE/100mL, EPA 2012 RWQC). */
export const ENTERO_PASS_THRESHOLD = 35;
/** Marine / tidal Enterococci upper limit for "caution". */
export const ENTERO_CAUTION_MAX = 130;

/** A reading older than this many days is shown as "stale" in the UI. */
export const STALE_THRESHOLD_DAYS = 7;

/** Cumulative precipitation (inches, 48h) that triggers a rain advisory. */
export const RAIN_THRESHOLD_INCHES_48H = 1.0;

/** Precipitation (inches, past 24h) triggering the recent-rain advisory — freshwater sites.
 *  Basis: DC DOEE stormwater guidance; 0.5 in typically mobilises E. coli above contact thresholds. */
export const RAIN_THRESHOLD_INCHES_24H_FRESHWATER = 0.5;

/** Same threshold for tidal/brackish sites — lower because DC Water CSOs activate at ≈0.25 in,
 *  driving rapid enterococci spikes in the Anacostia and tidal Potomac. */
export const RAIN_THRESHOLD_INCHES_24H_TIDAL = 0.25;

// ---------------------------------------------------------------------------
// Status configuration map
// ---------------------------------------------------------------------------

/**
 * Visual + copy configuration for each {@link WaterStatus}.
 *
 * Centralized so every surface (map pin, list row, detail header, email)
 * renders identical color, icon, and language for a given status.
 * `stale` is intentionally omitted — staleness is an overlay, not a status.
 */
export const STATUS_CONFIG: Record<Exclude<WaterStatus, "stale">, StatusConfig> = {
  pass: {
    status: "pass",
    label: "Pass",
    color: "text-green-700 dark:text-green-300",
    bgColor: "bg-green-100 dark:bg-green-950",
    borderColor: "border-green-500",
    icon: "CheckCircle",
    safeForSwimming: true,
    safeForKayaking: true,
    safeForWading: true,
    shortMessage: "Bacteria below EPA single-sample threshold.",
    longMessage:
      "The most recent sample is below the EPA 2012 RWQC single-sample threshold. " +
      "Conditions can change rapidly — always check for newer readings after rainfall.",
  },
  caution: {
    status: "caution",
    label: "Caution",
    color: "text-amber-700 dark:text-amber-300",
    bgColor: "bg-amber-100 dark:bg-amber-950",
    borderColor: "border-amber-500",
    icon: "AlertTriangle",
    safeForSwimming: false,
    safeForKayaking: true,
    safeForWading: true,
    shortMessage: "Elevated bacteria — limit full-body immersion.",
    longMessage:
      "Bacteria levels exceed the EPA single-sample pass threshold but remain below " +
      "the unsafe ceiling. Avoid swallowing water and rinse off after contact.",
  },
  unsafe: {
    status: "unsafe",
    label: "Unsafe",
    color: "text-red-700 dark:text-red-300",
    bgColor: "bg-red-100 dark:bg-red-950",
    borderColor: "border-red-500",
    icon: "XCircle",
    safeForSwimming: false,
    safeForKayaking: false,
    safeForWading: false,
    shortMessage: "Bacteria exceed safe contact levels — avoid water.",
    longMessage:
      "Bacteria levels exceed the EPA upper threshold. Avoid all contact with the water " +
      "until a more recent sample confirms safer conditions.",
  },
  no_data: {
    status: "no_data",
    label: "No Data",
    color: "text-gray-700 dark:text-gray-300",
    bgColor: "bg-gray-100 dark:bg-gray-900",
    borderColor: "border-gray-400",
    icon: "HelpCircle",
    safeForSwimming: false,
    safeForKayaking: false,
    safeForWading: false,
    shortMessage: "No recent reading available.",
    longMessage:
      "No recent bacteria sample is available for this site. Consult the listed data " +
      "source or local health authority before recreating.",
  },
} as const;

// ---------------------------------------------------------------------------
// Legal / safety disclaimer strings
// ---------------------------------------------------------------------------

/**
 * Disclaimer copy used across the app. Placeholders like `{source}` are
 * intentionally left as literal text and substituted at the call site so
 * this module stays free of any I/O / formatting opinions.
 */
export const DISCLAIMERS = {
  siteCard:
    "Advisory only. Not a regulatory determination. Conditions change rapidly after rain events.",
  aiExplanation:
    "Based on {source} data from {date} using EPA 2012 RWQC guidelines. " +
    "Not a regulatory determination. Consult {agency} for official guidance.",
  rainAdvisory:
    "Heavy rainfall in the past 48 hours may have elevated bacteria levels beyond " +
    "the most recent reading. Exercise caution regardless of current status.",
  recentRainAdvisory:
    "{inches} in of rain in the last 24h nearby. Bacteria levels are often elevated for " +
    "24–48 hours after rain — this reading may not reflect current conditions.",
  staleData:
    "This reading is {days} days old. Water quality can change rapidly. " +
    "Check for a more recent reading before recreating.",
  alertEmail:
    "Advisory only. WaterWatch DMV aggregates publicly available monitoring data " +
    "and is not a regulatory authority. Source: {source}.",
  firstUse:
    "WaterWatch DMV provides water quality information for informational purposes " +
    "only. It does not replace official health department advisories. Users assume " +
    "all risk associated with recreational water use.",
  footer:
    "Data: USGS, EPA WQP, Arlington County DES, Swim Guide. Standards: EPA 2012 RWQC, " +
    "VA DEQ. Not a regulatory authority.",
} as const;

// ---------------------------------------------------------------------------
// Core decision functions
// ---------------------------------------------------------------------------

/**
 * Classify a single bacteria value against the appropriate threshold pair.
 *
 * WHY a helper: keeps `getWaterStatus` readable when reconciling two
 * independent indicators (E. coli + Enterococci) for the same site.
 *
 * @param value measured concentration, or null if not measured
 * @param passMax inclusive upper bound for "pass"
 * @param cautionMax inclusive upper bound for "caution"
 * @returns "pass" | "caution" | "unsafe" | null when no value present
 */
function classifyValue(
  value: number | null,
  passMax: number,
  cautionMax: number,
): Exclude<WaterStatus, "no_data" | "stale"> | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (value <= passMax) return "pass";
  if (value <= cautionMax) return "caution";
  return "unsafe";
}

/** Severity ranking — higher number = more dangerous. */
const SEVERITY: Record<Exclude<WaterStatus, "no_data" | "stale">, number> = {
  pass: 0,
  caution: 1,
  unsafe: 2,
};

/**
 * Derive display-ready {@link StatusConfig} from raw bacteria readings.
 *
 * Selection rules:
 *  - `freshwater`     → evaluate E. coli against `ECOLI_*` thresholds.
 *  - `tidal_brackish` → evaluate Enterococci against `ENTERO_*` thresholds.
 *  - If both values are present, evaluate both and surface the **more
 *    conservative** (worse) classification. WHY: under-reporting risk in
 *    safety-critical UI is unacceptable.
 *  - If neither value is present, return the `no_data` config.
 *
 * Staleness is intentionally NOT considered here — it is rendered as an
 * overlay so the underlying classification remains visible.
 *
 * @param eColiMpn E. coli concentration in MPN/100mL, or null
 * @param enterococciCce Enterococci concentration in CCE/100mL, or null
 * @param waterBodyType `"freshwater"` or `"tidal_brackish"`
 * @param _sampledAt ISO timestamp of the sample (unused here; see
 *                   {@link isStaleReading} for the staleness overlay)
 * @returns StatusConfig matching the derived status
 */
export function getWaterStatus(
  eColiMpn: number | null,
  enterococciCce: number | null,
  waterBodyType: "freshwater" | "tidal_brackish",
  _sampledAt: string,
): StatusConfig {
  const ecoli = classifyValue(eColiMpn, ECOLI_PASS_THRESHOLD, ECOLI_CAUTION_MAX);
  const entero = classifyValue(enterococciCce, ENTERO_PASS_THRESHOLD, ENTERO_CAUTION_MAX);

  // Collect the indicators that are valid for this water body type.
  // We still consider the "off-type" indicator when present so a freshwater
  // site that happens to report Enterococci can't silently downgrade risk.
  const candidates: Array<Exclude<WaterStatus, "no_data" | "stale">> = [];
  if (waterBodyType === "freshwater") {
    if (ecoli) candidates.push(ecoli);
    if (entero) candidates.push(entero);
  } else {
    if (entero) candidates.push(entero);
    if (ecoli) candidates.push(ecoli);
  }

  if (candidates.length === 0) return STATUS_CONFIG.no_data;

  // Pick the worst (highest severity) — fail safe.
  const worst = candidates.reduce((acc, s) => (SEVERITY[s] > SEVERITY[acc] ? s : acc));
  return STATUS_CONFIG[worst];
}

/**
 * True when `sampledAt` is older than {@link STALE_THRESHOLD_DAYS}.
 *
 * Boundary: exactly 7 days old (to the millisecond) counts as stale.
 * Invalid date strings are treated as stale — better to over-warn than
 * to silently treat unparseable timestamps as fresh.
 *
 * @param sampledAt ISO 8601 timestamp
 */
export function isStaleReading(sampledAt: string): boolean {
  const t = Date.parse(sampledAt);
  if (Number.isNaN(t)) return true;
  const ageMs = Date.now() - t;
  const thresholdMs = STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
  return ageMs >= thresholdMs;
}

/**
 * True when 48-hour precipitation meets or exceeds
 * {@link RAIN_THRESHOLD_INCHES_48H}. WHY: stormwater runoff is the dominant
 * driver of acute bacteria spikes in the DMV watershed; a 1.0" / 48h event
 * routinely elevates bacteria above safe contact levels even when the last
 * official sample was clean.
 *
 * @param precipInches48h cumulative precipitation in inches over 48h
 */
export function shouldShowRainAdvisory(precipInches48h: number): boolean {
  return precipInches48h >= RAIN_THRESHOLD_INCHES_48H;
}

/**
 * True when 24-hour precipitation meets or exceeds the site-type-specific threshold.
 *
 * WHY different thresholds: tidal DMV waterways (Anacostia, tidal Potomac) are
 * immediately downstream of combined sewer overflows (CSOs) that activate at
 * ≈0.25 in of rain. Freshwater sites respond to runoff at a higher threshold.
 *
 * This advisory does NOT override the bacteria classification — it contextualises
 * a reading that may be days old.
 *
 * @param precipInches24h cumulative precipitation (inches) over the past 24h
 * @param isTidal true for tidal_brackish sites
 */
export function shouldShowRecentRainAdvisory(precipInches24h: number, isTidal: boolean): boolean {
  const threshold = isTidal
    ? RAIN_THRESHOLD_INCHES_24H_TIDAL
    : RAIN_THRESHOLD_INCHES_24H_FRESHWATER;
  return precipInches24h >= threshold;
}

/**
 * Geometric mean of bacteria readings, per EPA statistical guidance.
 *
 * Returns `null` when fewer than 5 readings are supplied — EPA 2012 RWQC
 * requires a minimum of 5 samples for a statistically valid GM.
 *
 * Zero handling: a single zero would collapse the GM to zero. We apply the
 * standard 0.5 substitution method (replace 0 with 0.5) so non-detects do
 * not mask elevated samples. Negative values are treated as 0 (and then
 * substituted to 0.5) — bacteria counts can never be negative.
 *
 * @param readings array of bacteria concentrations
 * @returns geometric mean, or null if fewer than 5 readings
 */
export function calculateGeometricMean(readings: number[]): number | null {
  if (!Array.isArray(readings) || readings.length < 5) return null;
  const adjusted = readings.map((r) => {
    const v = typeof r === "number" && !Number.isNaN(r) ? r : 0;
    return v <= 0 ? 0.5 : v;
  });
  // Use log-space sum to avoid overflow on long series.
  const sumLn = adjusted.reduce((acc, v) => acc + Math.log(v), 0);
  return Math.exp(sumLn / adjusted.length);
}

/**
 * Plain-language advisory for a given activity at a given water status.
 *
 * Risk ordering (highest → lowest): swimming > wading > kayaking > fishing.
 * Swimming involves full immersion + likely water ingestion; fishing from
 * a bank/boat involves no immersion at all.
 *
 * Hard rules (enforced by tests):
 *  - Never assert "you will not get sick".
 *  - Never claim "100% safe".
 *  - Always reference EPA guidelines and frame output as advisory.
 *
 * @param status display status from {@link getWaterStatus}
 * @param activity one of `'swimming' | 'kayaking' | 'wading' | 'fishing'`
 * @returns a single-paragraph advisory string
 */
export function getActivityAdvisory(
  status: WaterStatus,
  activity: "swimming" | "kayaking" | "wading" | "fishing",
): string {
  const epaTail =
    "Guidance is advisory only, based on EPA 2012 RWQC thresholds, and not a regulatory determination.";

  if (status === "no_data" || status === "stale") {
    return (
      `No current bacteria reading is available for ${activity}. ` +
      `Check the listed data source or your local health authority before entering the water. ${epaTail}`
    );
  }

  if (status === "pass") {
    switch (activity) {
      case "swimming":
        return `The most recent sample is below the EPA single-sample pass threshold for swimming. Risk of illness from this sample is lower, but conditions can shift quickly after rain. ${epaTail}`;
      case "wading":
        return `Wading conditions appear acceptable under EPA guidelines based on the most recent sample. Rinse off afterward and avoid swallowing water. ${epaTail}`;
      case "kayaking":
        return `Kayaking conditions appear acceptable under EPA guidelines based on the most recent sample. Avoid capsize-prone activities if you have open cuts. ${epaTail}`;
      case "fishing":
        return `Fishing from shore or boat carries minimal contact risk and the most recent sample is below the EPA pass threshold. Wash hands before eating. ${epaTail}`;
    }
  }

  if (status === "caution") {
    switch (activity) {
      case "swimming":
        return `Bacteria levels exceed the EPA pass threshold for swimming. Avoid full-body immersion, especially for children, the elderly, and anyone immunocompromised. ${epaTail}`;
      case "wading":
        return `Bacteria are elevated above the EPA pass threshold. Brief wading carries some risk — avoid open cuts contacting the water and rinse off afterward. ${epaTail}`;
      case "kayaking":
        return `Bacteria are elevated above the EPA pass threshold. Kayaking is generally lower-risk than swimming, but take care to avoid capsizing or splashing water into your mouth or eyes. ${epaTail}`;
      case "fishing":
        return `Bacteria are elevated above the EPA pass threshold. Fishing from shore or boat remains low-contact; wash hands thoroughly before handling food. ${epaTail}`;
    }
  }

  // status === "unsafe"
  switch (activity) {
    case "swimming":
      return `Bacteria exceed the EPA upper threshold. Swimming is strongly discouraged until a newer sample confirms safer conditions. ${epaTail}`;
    case "wading":
      return `Bacteria exceed the EPA upper threshold. Avoid wading; even brief contact carries elevated risk of gastrointestinal illness. ${epaTail}`;
    case "kayaking":
      return `Bacteria exceed the EPA upper threshold. Postpone kayaking if possible; if you must go out, avoid all water contact and rinse off thoroughly afterward. ${epaTail}`;
    case "fishing":
      return `Bacteria exceed the EPA upper threshold. Fishing from shore or boat is the lowest-contact option, but avoid touching the water and wash hands thoroughly before handling food. ${epaTail}`;
  }
}
