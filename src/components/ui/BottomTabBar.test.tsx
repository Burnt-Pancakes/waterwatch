// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

afterEach(cleanup);

vi.mock("@tanstack/react-router", () => ({
  useRouterState: () => ({ location: { pathname: "/" } }),
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: null, session: null, loading: false }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => Promise.resolve({ count: 0 }) }),
      }),
    }),
  },
}));

describe("BottomTabBar", () => {
  it("renders all four navigation tabs", async () => {
    const { BottomTabBar } = await import("./BottomTabBar");
    const { findByTestId } = render(<BottomTabBar />);
    expect(await findByTestId("bottom-tab-bar")).toBeTruthy();
    expect(await findByTestId("tab-map")).toBeTruthy();
    expect(await findByTestId("tab-rivers")).toBeTruthy();
    expect(await findByTestId("tab-plan")).toBeTruthy();
    expect(await findByTestId("tab-tides")).toBeTruthy();
  });

  it("is visible on all viewports", async () => {
    const { BottomTabBar } = await import("./BottomTabBar");
    const { findByTestId } = render(<BottomTabBar />);
    const nav = await findByTestId("bottom-tab-bar");
    expect(nav.className).not.toContain("md:hidden");
  });

  it("marks Map tab as active when on / route", async () => {
    const { BottomTabBar } = await import("./BottomTabBar");
    const { findByTestId } = render(<BottomTabBar />);
    const mapTab = await findByTestId("tab-map");
    expect(mapTab.getAttribute("aria-current")).toBe("page");
  });

  it("does not mark Rivers tab as active when on / route", async () => {
    const { BottomTabBar } = await import("./BottomTabBar");
    const { findByTestId } = render(<BottomTabBar />);
    const riversTab = await findByTestId("tab-rivers");
    expect(riversTab.getAttribute("aria-current")).toBeNull();
  });
});
