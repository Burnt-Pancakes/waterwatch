// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FirstUseDisclaimer } from "./FirstUseDisclaimer";

afterEach(cleanup);

const STORAGE_KEY = "watervoice_disclaimer_accepted";
const routerPath = vi.hoisted(() => ({ current: "/" }));

vi.mock("@tanstack/react-router", () => ({
  useRouterState: () => routerPath.current,
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

describe("FirstUseDisclaimer", () => {
  beforeEach(() => {
    routerPath.current = "/";
    localStorage.clear();
  });

  it("renders the dialog when localStorage key is absent", () => {
    render(<FirstUseDisclaimer />);
    expect(screen.getByTestId("first-use-disclaimer")).toBeTruthy();
  });

  it("does not render when localStorage key is already set", () => {
    localStorage.setItem(STORAGE_KEY, "1");
    render(<FirstUseDisclaimer />);
    expect(screen.queryByTestId("first-use-disclaimer")).toBeNull();
  });

  it("sets localStorage key and dismisses when CTA button is clicked", () => {
    render(<FirstUseDisclaimer />);
    const btn = screen.getByTestId("disclaimer-accept-btn");
    fireEvent.click(btn);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("1");
    expect(screen.queryByTestId("first-use-disclaimer")).toBeNull();
  });

  it("cannot be dismissed without clicking the accept button", () => {
    render(<FirstUseDisclaimer />);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);
    expect(screen.getByTestId("first-use-disclaimer")).toBeTruthy();
  });

  it("has aria-modal=true for accessibility", () => {
    render(<FirstUseDisclaimer />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("includes an About WaterVoice link before acceptance", () => {
    render(<FirstUseDisclaimer />);
    const aboutLink = screen.getByRole("link", { name: /about watervoice/i });
    expect(aboutLink.getAttribute("href")).toBe("/about");
  });

  it("does not block informational routes before acceptance", () => {
    routerPath.current = "/about";
    render(<FirstUseDisclaimer />);
    expect(screen.queryByTestId("first-use-disclaimer")).toBeNull();
  });
});
