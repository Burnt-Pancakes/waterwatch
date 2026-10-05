// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AppFooter } from "./AppFooter";
import { DISCLAIMERS } from "@/lib/waterQualityEngine";

afterEach(cleanup);

vi.mock("@tanstack/react-router", () => ({
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

describe("AppFooter", () => {
  it("renders DISCLAIMERS.footer text", () => {
    render(<AppFooter />);
    expect(screen.getByText(DISCLAIMERS.footer)).toBeTruthy();
  });

  it("renders Terms link", () => {
    render(<AppFooter />);
    expect(screen.getByRole("link", { name: "Terms" })).toBeTruthy();
  });

  it("renders Privacy link", () => {
    render(<AppFooter />);
    expect(screen.getByRole("link", { name: "Privacy" })).toBeTruthy();
  });

  it("renders About link", () => {
    render(<AppFooter />);
    expect(screen.getByRole("link", { name: "About" })).toBeTruthy();
  });

  it("renders Contact link", () => {
    render(<AppFooter />);
    expect(screen.getByRole("link", { name: "Contact" })).toBeTruthy();
  });

  it("renders CivicTech DC attribution linking to civictechdc.org", () => {
    render(<AppFooter />);
    const link = screen.getByRole("link", { name: /CivicTech DC/i });
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("https://civictechdc.org");
  });
});
