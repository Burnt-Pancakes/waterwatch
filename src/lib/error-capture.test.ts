// @vitest-environment jsdom
// jsdom provides globalThis.addEventListener so the module registers its listeners.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Fresh import in jsdom ensures the event listeners are actually registered.
import { consumeLastCapturedError } from "./error-capture";

beforeEach(() => {
  // Drain any leftover state from a previous test.
  consumeLastCapturedError();
});

afterEach(() => {
  consumeLastCapturedError();
});

describe("consumeLastCapturedError — no error recorded", () => {
  it("returns undefined when no error has been captured", () => {
    expect(consumeLastCapturedError()).toBeUndefined();
  });

  it("returns undefined on subsequent calls", () => {
    expect(consumeLastCapturedError()).toBeUndefined();
    expect(consumeLastCapturedError()).toBeUndefined();
  });
});

describe("consumeLastCapturedError — error via unhandledrejection event", () => {
  it("returns the rejection reason after an unhandledrejection event", async () => {
    const reason = new Error("async failure");
    // Create the rejected promise separately so we can suppress the
    // engine-level unhandled-rejection tracking while still dispatching
    // the event that the module listens for.
    const promise = Promise.reject(reason);
    promise.catch(() => {});
    window.dispatchEvent(
      new PromiseRejectionEvent("unhandledrejection", {
        promise,
        reason,
        cancelable: true,
      }),
    );

    // Allow the event listener to fire.
    await Promise.resolve();

    const captured = consumeLastCapturedError();
    expect(captured).toBe(reason);
  });

  it("returns undefined after the error has been consumed once", async () => {
    const reason = new Error("one-shot");
    const promise = Promise.reject(reason);
    promise.catch(() => {});
    window.dispatchEvent(
      new PromiseRejectionEvent("unhandledrejection", {
        promise,
        reason,
        cancelable: true,
      }),
    );
    await Promise.resolve();

    consumeLastCapturedError(); // first call — consumes it
    expect(consumeLastCapturedError()).toBeUndefined(); // second call
  });
});

describe("consumeLastCapturedError — error via error event", () => {
  it("returns the error from a global error event", async () => {
    const err = new TypeError("sync failure");
    window.dispatchEvent(new ErrorEvent("error", { error: err, cancelable: true }));
    await Promise.resolve();

    const captured = consumeLastCapturedError();
    expect(captured).toBe(err);
  });

  it("overwrites a previously captured error with the newest one", async () => {
    const first = new Error("first");
    const second = new Error("second");

    window.dispatchEvent(new ErrorEvent("error", { error: first }));
    window.dispatchEvent(new ErrorEvent("error", { error: second }));
    await Promise.resolve();

    const captured = consumeLastCapturedError();
    expect(captured).toBe(second);
  });
});
