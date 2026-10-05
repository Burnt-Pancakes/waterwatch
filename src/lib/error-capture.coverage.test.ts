// @vitest-environment jsdom
/**
 * Additional coverage for error-capture.ts — the TTL expiry branch
 * (lines 21–22) not reachable from the primary test file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeLastCapturedError } from "./error-capture";

beforeEach(() => {
  consumeLastCapturedError(); // drain any leftover state
});

afterEach(() => {
  vi.useRealTimers();
  consumeLastCapturedError();
});

describe("consumeLastCapturedError — TTL expiry", () => {
  it("returns undefined and clears the error when the 5-second TTL has elapsed", async () => {
    vi.useFakeTimers();

    // Capture an error.
    const err = new Error("captured error");
    window.dispatchEvent(new ErrorEvent("error", { error: err }));
    await Promise.resolve();

    // Advance time beyond the 5-second TTL.
    vi.advanceTimersByTime(6_000);

    const result = consumeLastCapturedError();

    expect(result).toBeUndefined();
  });

  it("returns the error when TTL has NOT elapsed", async () => {
    vi.useFakeTimers();

    const err = new Error("fresh error");
    window.dispatchEvent(new ErrorEvent("error", { error: err }));
    await Promise.resolve();

    // Only 1 second elapsed — still within the 5-second TTL.
    vi.advanceTimersByTime(1_000);

    const result = consumeLastCapturedError();

    expect(result).toBe(err);
  });
});
