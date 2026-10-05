// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { InstallPrompt } from "./InstallPrompt";

const VISIT_KEY = "watervoice_visit_count";
const DISMISSED_KEY = "watervoice_install_dismissed";

/** Helper: mock window.matchMedia for display-mode checks */
function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query.includes("standalone") ? matches : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => {
  localStorage.clear();
  // Default: not in standalone mode
  mockMatchMedia(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("InstallPrompt", () => {
  it("does not render when display-mode is standalone", () => {
    // Simulate the app already installed as PWA
    mockMatchMedia(true);
    const { container } = render(<InstallPrompt />);
    expect(container.firstChild).toBeNull();
  });

  it("does not render when dismissed flag is set in localStorage", () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    localStorage.setItem(VISIT_KEY, "5");
    const { container } = render(<InstallPrompt />);
    expect(container.firstChild).toBeNull();
  });

  it("renders after 3rd visit (localStorage count starts at 2, mount increments to 3)", () => {
    localStorage.setItem(VISIT_KEY, "2");
    const { getByText } = render(<InstallPrompt />);
    expect(getByText(/Add WaterVoice to your home screen/i)).toBeTruthy();
  });

  it("'Not now' button sets DISMISSED_KEY in localStorage", () => {
    localStorage.setItem(VISIT_KEY, "2");
    const { getAllByRole } = render(<InstallPrompt />);
    // Use getAllByRole to handle potential duplicates, then pick the first match
    const notNowBtns = getAllByRole("button", { name: /not now/i });
    fireEvent.click(notNowBtns[0]);
    expect(localStorage.getItem(DISMISSED_KEY)).toBe("1");
  });

  it("increments visit counter on each render", () => {
    expect(localStorage.getItem(VISIT_KEY)).toBeNull();
    render(<InstallPrompt />);
    expect(localStorage.getItem(VISIT_KEY)).toBe("1");
  });
});
