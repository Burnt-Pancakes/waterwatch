/**
 * localStorage-backed focus group state, scoped per round.
 *
 * Every helper is SSR-safe: when `window` is undefined they return
 * sensible defaults and never touch storage.
 */

import { CLOSE_DATE, FOCUS_GROUP_ROUND, OPEN_DATE } from "./config";

const PREFIX = `watervoice_fg_${FOCUS_GROUP_ROUND}_`;

function key(name: string): string {
  return `${PREFIX}${name}`;
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Returns this device's stable focus group ID, creating and persisting
 * one on first call. Returns null during SSR.
 */
export function getDeviceId(): string | null {
  const store = storage();
  if (!store) return null;
  const existing = store.getItem(key("device_id"));
  if (existing) return existing;
  const id = crypto.randomUUID();
  store.setItem(key("device_id"), id);
  return id;
}

/** True when the given prompt has already been answered/dismissed this round. */
export function isDone(id: string): boolean {
  const store = storage();
  if (!store) return false;
  return store.getItem(key(`done_${id}`)) === "1";
}

/** Marks the given prompt as answered/dismissed for this round. */
export function markDone(id: string): void {
  const store = storage();
  if (!store) return;
  store.setItem(key(`done_${id}`), "1");
}

/** Number of automatic prompts already shown this device/round (0 during SSR). */
export function autoPromptCount(): number {
  const store = storage();
  if (!store) return 0;
  const raw = store.getItem(key("auto_prompt_count"));
  const n = raw === null ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Increments the automatic-prompt counter. No-op during SSR. */
export function incrementAutoPromptCount(): void {
  const store = storage();
  if (!store) return;
  store.setItem(key("auto_prompt_count"), String(autoPromptCount() + 1));
}

/**
 * True when today's date falls within [OPEN_DATE, CLOSE_DATE].
 * A null bound means that side of the window is open.
 * Always true during SSR (gating is a client-side concern).
 */
export function isWindowOpen(): boolean {
  if (typeof window === "undefined") return true;
  const today = new Date().toISOString().slice(0, 10);
  if (OPEN_DATE !== null && today < OPEN_DATE) return false;
  if (CLOSE_DATE !== null && today > CLOSE_DATE) return false;
  return true;
}
