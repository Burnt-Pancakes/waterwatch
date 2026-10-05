export type Thresholds = {
  too_low_ft: number | null;
  optimal_min_ft: number | null;
  optimal_max_ft: number | null;
  caution_max_ft: number | null;
  notes: string | null;
};

export type StageBadge = {
  label: "Too low" | "Optimal" | "Caution" | "Flood";
  className: string;
};

export type GaugeReading = {
  recorded_at: string;
  stage_ft: number | null;
  flow_cfs: number | null;
  trend: "rising" | "falling" | "steady" | null;
};

export const TREND_ARROW: Record<
  NonNullable<GaugeReading["trend"]>,
  { arrow: string; aria: string }
> = {
  rising: { arrow: "↑", aria: "Rising" },
  falling: { arrow: "↓", aria: "Falling" },
  steady: { arrow: "→", aria: "Steady" },
};

/** Map a stage reading to a badge using per-gauge thresholds. */
export function classifyStage(stage: number, t: Thresholds | null): StageBadge | null {
  if (!t) return null;
  const { too_low_ft, optimal_min_ft, optimal_max_ft, caution_max_ft } = t;
  if (too_low_ft != null && too_low_ft > 0 && stage < too_low_ft) {
    return {
      label: "Too low",
      className: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
    };
  }
  if (caution_max_ft != null && stage > caution_max_ft) {
    return {
      label: "Flood",
      className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
    };
  }
  if (
    optimal_max_ft != null &&
    stage > optimal_max_ft &&
    (caution_max_ft == null || stage <= caution_max_ft)
  ) {
    return {
      label: "Caution",
      className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    };
  }
  if (
    optimal_min_ft != null &&
    optimal_max_ft != null &&
    stage >= optimal_min_ft &&
    stage <= optimal_max_ft
  ) {
    return {
      label: "Optimal",
      className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    };
  }
  return null;
}

export function relativeTime(iso: string): string {
  const diffMs = Date.now() - Date.parse(iso);
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
