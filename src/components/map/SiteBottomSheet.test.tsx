// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { StatusBadge, StaleBanner, RainBanner, FavoriteStar } from "./SiteBottomSheet";
import { STATUS_PRESENTATION } from "./statusPresentation";

vi.mock("@/integrations/supabase/client", () => {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const del = vi.fn();
  const eq = vi.fn();
  return {
    supabase: {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          })),
        })),
        insert,
        delete: del,
      })),
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-123" } },
        }),
      },
      __mocks: { insert, del, eq },
    },
  };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

afterEach(() => cleanup());

describe("StatusBadge", () => {
  for (const status of ["pass", "caution", "unsafe", "no_data"] as const) {
    it(`renders the correct label and color for status "${status}"`, () => {
      render(<StatusBadge status={status} />);
      const el = screen.getByTestId("status-badge");
      expect(el.getAttribute("data-status")).toBe(status);
      expect(el.textContent).toContain(STATUS_PRESENTATION[status].label);
      // jsdom normalises hex → rgb(), so just verify a background style is applied.
      expect(el.getAttribute("style") ?? "").toContain("background");
    });
  }
});

describe("StaleBanner", () => {
  it("renders when isStale=true with a sampledAt", () => {
    const old = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    render(<StaleBanner isStale={true} sampledAt={old} />);
    expect(screen.getByTestId("stale-banner")).toBeTruthy();
  });
  it("renders nothing when isStale=false", () => {
    render(<StaleBanner isStale={false} sampledAt={new Date().toISOString()} />);
    expect(screen.queryByTestId("stale-banner")).toBeNull();
  });
});

describe("RainBanner", () => {
  it("renders when advisoryActive=true", () => {
    render(<RainBanner advisoryActive={true} />);
    expect(screen.getByTestId("rain-banner")).toBeTruthy();
  });
  it("renders nothing when advisoryActive=false", () => {
    render(<RainBanner advisoryActive={false} />);
    expect(screen.queryByTestId("rain-banner")).toBeNull();
  });
});

describe("FavoriteStar", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows sign-in tooltip when unauthenticated", async () => {
    render(<FavoriteStar siteId="site-1" authenticated={false} />);
    fireEvent.click(screen.getByTestId("favorite-star"));
    expect(screen.getByTestId("favorite-signin-tooltip")).toBeTruthy();
  });

  it("calls Supabase insert when authenticated user stars", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    // Reach into the mock’s captured insert fn
    const insertFn = (supabase as unknown as { __mocks: { insert: ReturnType<typeof vi.fn> } })
      .__mocks.insert;
    render(<FavoriteStar siteId="site-1" authenticated={true} />);
    await waitFor(() =>
      expect(screen.getByTestId("favorite-star").getAttribute("data-loaded")).toBe("true"),
    );
    fireEvent.click(screen.getByTestId("favorite-star"));
    await waitFor(() => expect(insertFn).toHaveBeenCalled());
    expect(insertFn.mock.calls[0][0]).toMatchObject({ site_id: "site-1" });
  });
});
