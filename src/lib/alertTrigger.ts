import { getWaterStatus } from "@/lib/waterQualityEngine";

/**
 * Derives a status string from raw reading values.
 * Pure function — no I/O, safe to call in tests.
 */
export function computeStatus(
  eColiMpn: number | null,
  enterococciCce: number | null,
  waterBodyType: "freshwater" | "tidal_brackish",
): string {
  return getWaterStatus(eColiMpn, enterococciCce, waterBodyType, new Date().toISOString()).status;
}

/**
 * Returns true when the new status warrants a notification:
 *  - Status has actually changed (oldStatus !== newStatus).
 *  - The new status is in the user's triggerOn list.
 */
export function shouldFireAlert(
  triggerOn: string[],
  oldStatus: string,
  newStatus: string,
): boolean {
  if (oldStatus === newStatus) return false;
  return triggerOn.includes(newStatus);
}
