/** Values stored in `alerts.trigger_on` (water quality + weather). */
export const WATER_QUALITY_TRIGGERS = ["pass", "caution", "unsafe"] as const;
export const WEATHER_ADVISORY_TRIGGER = "weather_advisory" as const;

export type WaterQualityTrigger = (typeof WATER_QUALITY_TRIGGERS)[number];
export type AlertTrigger = WaterQualityTrigger | typeof WEATHER_ADVISORY_TRIGGER;

export const ALL_ALERT_TRIGGERS = [...WATER_QUALITY_TRIGGERS, WEATHER_ADVISORY_TRIGGER] as const;

export const TRIGGER_LABELS: Record<AlertTrigger, string> = {
  caution: "Alert me when status changes to Caution",
  unsafe: "Alert me when status changes to Unsafe",
  pass: "Alert me when status improves to Pass",
  weather_advisory: "Alert me when there are weather advisories",
};

export const TRIGGER_DISPLAY_NAMES: Record<AlertTrigger, string> = {
  caution: "Caution",
  unsafe: "Unsafe",
  pass: "Pass",
  weather_advisory: "Weather advisories",
};

export function formatTriggerOn(triggerOn: string[]): string {
  return triggerOn.map((t) => TRIGGER_DISPLAY_NAMES[t as AlertTrigger] ?? t).join(", ");
}

export function wantsWeatherAdvisoryAlerts(triggerOn: string[]): boolean {
  return triggerOn.includes(WEATHER_ADVISORY_TRIGGER);
}
