// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { FOCUS_GROUP_ROUND, MAX_AUTO_PROMPTS } from "@/lib/focusGroup/config";

afterEach(cleanup);

let currentPath = "/";

vi.mock("@tanstack/react-router", () => ({
  useRouterState: () => ({ location: { pathname: currentPath } }),
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: () => Promise.resolve({ error: null }),
    }),
  },
}));

const PREFIX = `watervoice_fg_${FOCUS_GROUP_ROUND}_`;

beforeEach(() => {
  window.localStorage.clear();
  currentPath = "/";
});

describe("FocusGroup", () => {
  it("renders nothing on a hidden route (/privacy)", async () => {
    currentPath = "/privacy";
    const { FocusGroup } = await import("./FocusGroup");
    const { queryByTestId } = render(<FocusGroup />);
    await act(async () => {});
    expect(queryByTestId("focus-group-bar")).toBeNull();
    expect(queryByTestId("focus-group-intro")).toBeNull();
  });

  it("renders the bar on /", async () => {
    const { FocusGroup } = await import("./FocusGroup");
    const { findByTestId } = render(<FocusGroup />);
    expect(await findByTestId("focus-group-bar")).toBeTruthy();
  });

  it("does not show the intro when the auto-prompt cap is reached", async () => {
    vi.useFakeTimers();
    try {
      // All gates open except the cap.
      window.localStorage.setItem("watervoice_disclaimer_accepted", "1");
      window.localStorage.setItem(PREFIX + "auto_prompt_count", String(MAX_AUTO_PROMPTS));

      const { FocusGroup } = await import("./FocusGroup");
      const { queryByTestId } = render(<FocusGroup />);
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      expect(queryByTestId("focus-group-intro")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
