// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getDeviceId,
  isDone,
  markDone,
  autoPromptCount,
  incrementAutoPromptCount,
  isWindowOpen,
} from "./storage";
import { FOCUS_GROUP_ROUND } from "./config";

const PREFIX = `watervoice_fg_${FOCUS_GROUP_ROUND}_`;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getDeviceId", () => {
  it("creates a device id on first call and persists it across calls", () => {
    const id = getDeviceId();
    expect(id).toBeTruthy();
    expect(getDeviceId()).toBe(id);
    expect(window.localStorage.getItem(`${PREFIX}device_id`)).toBe(id);
  });

  it("returns null when window is unavailable (SSR)", () => {
    vi.stubGlobal("window", undefined);
    expect(getDeviceId()).toBeNull();
  });
});

describe("isDone / markDone", () => {
  it("is false until the id is marked done", () => {
    expect(isDone("q1")).toBe(false);
    markDone("q1");
    expect(isDone("q1")).toBe(true);
    expect(isDone("q2")).toBe(false);
  });

  it("are no-ops without window", () => {
    vi.stubGlobal("window", undefined);
    expect(isDone("q1")).toBe(false);
    expect(() => markDone("q1")).not.toThrow();
  });
});

describe("autoPromptCount / incrementAutoPromptCount", () => {
  it("starts at 0 and increments", () => {
    expect(autoPromptCount()).toBe(0);
    incrementAutoPromptCount();
    expect(autoPromptCount()).toBe(1);
    incrementAutoPromptCount();
    expect(autoPromptCount()).toBe(2);
  });

  it("treats a missing, negative, or non-numeric stored value as 0", () => {
    expect(autoPromptCount()).toBe(0);
    window.localStorage.setItem(`${PREFIX}auto_prompt_count`, "-5");
    expect(autoPromptCount()).toBe(0);
    window.localStorage.setItem(`${PREFIX}auto_prompt_count`, "not-a-number");
    expect(autoPromptCount()).toBe(0);
  });

  it("are no-ops / return 0 without window", () => {
    vi.stubGlobal("window", undefined);
    expect(autoPromptCount()).toBe(0);
    expect(() => incrementAutoPromptCount()).not.toThrow();
  });
});

describe("isWindowOpen", () => {
  it("defaults to true when window is unavailable (SSR)", () => {
    vi.stubGlobal("window", undefined);
    expect(isWindowOpen()).toBe(true);
  });

  it("is true when OPEN_DATE and CLOSE_DATE are both null", () => {
    expect(isWindowOpen()).toBe(true);
  });

  describe("date gating", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      vi.doUnmock("./config");
      vi.resetModules();
    });

    it("is false before OPEN_DATE", async () => {
      vi.doMock("./config", () => ({
        FOCUS_GROUP_ROUND: "round-1",
        OPEN_DATE: "2099-01-01",
        CLOSE_DATE: null,
      }));
      const mod = await import("./storage");
      expect(mod.isWindowOpen()).toBe(false);
    });

    it("is false after CLOSE_DATE", async () => {
      vi.doMock("./config", () => ({
        FOCUS_GROUP_ROUND: "round-1",
        OPEN_DATE: null,
        CLOSE_DATE: "2000-01-01",
      }));
      const mod = await import("./storage");
      expect(mod.isWindowOpen()).toBe(false);
    });

    it("is true between OPEN_DATE and CLOSE_DATE", async () => {
      vi.doMock("./config", () => ({
        FOCUS_GROUP_ROUND: "round-1",
        OPEN_DATE: "2000-01-01",
        CLOSE_DATE: "2099-01-01",
      }));
      const mod = await import("./storage");
      expect(mod.isWindowOpen()).toBe(true);
    });
  });
});
