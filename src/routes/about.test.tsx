// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";

// TanStack Router's Link requires a router context; stub it out.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a {...props}>{children}</a>
    ),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createFileRoute: () => (config: any) => config,
  };
});

// AppFooter imports DISCLAIMERS; stub waterQualityEngine to avoid server deps.
vi.mock("@/lib/waterQualityEngine", () => ({
  DISCLAIMERS: {
    footer:
      "Data: USGS, EPA WQP, Arlington County DES. Standards: EPA 2012 RWQC. Not a regulatory authority.",
  },
}));

// Import the named AboutPage component after mocks are declared.
// We render it directly rather than via Route to avoid router context issues.
let AboutPage: React.ComponentType;

beforeAll(async () => {
  // Dynamic import ensures mocks are applied first.
  const mod = await import("./about");
  // The TanStack route object's component property is the page component.
  // After our createFileRoute mock, Route is the config object itself.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AboutPage = (mod.Route as any).component as React.ComponentType;
});

describe("About page", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the WaterVoice DMV heading", () => {
    render(<AboutPage />);
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
  });

  it("contains status items for PASS, CAUTION, UNSAFE, NO DATA", () => {
    render(<AboutPage />);
    expect(screen.getByTestId("status-item-PASS")).toBeTruthy();
    expect(screen.getByTestId("status-item-CAUTION")).toBeTruthy();
    expect(screen.getByTestId("status-item-UNSAFE")).toBeTruthy();
    expect(screen.getByTestId("status-item-NO DATA")).toBeTruthy();
  });

  it("contains the disclaimer footer text", () => {
    render(<AboutPage />);
    // Text appears in both the Data Sources section and the AppFooter — use getAllByText.
    const matches = screen.getAllByText(/Not a regulatory authority/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("contains 'How It Works' section", () => {
    render(<AboutPage />);
    expect(screen.getByText("How It Works")).toBeTruthy();
  });

  it("contains 'Data Sources' section", () => {
    render(<AboutPage />);
    expect(screen.getByText("Data Sources")).toBeTruthy();
  });

  it("contains 'About the Project' section with civic tech attribution", () => {
    render(<AboutPage />);
    expect(screen.getByText("About the Project")).toBeTruthy();
    // CivicTech DC appears in both the About section and AppFooter — use getAllByText.
    const civicMatches = screen.getAllByText(/CivicTech DC/);
    expect(civicMatches.length).toBeGreaterThanOrEqual(1);
  });

  it("shows the advisory-only disclaimer text", () => {
    render(<AboutPage />);
    expect(screen.getByText(/advisory information only/i)).toBeTruthy();
  });
});
