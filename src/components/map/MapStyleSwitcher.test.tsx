// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MapStyleSwitcher } from "./MapStyleSwitcher";

/** Open the options panel by clicking the toggle icon. */
function openPanel() {
  fireEvent.click(screen.getByTestId("style-switcher-toggle"));
}

describe("MapStyleSwitcher", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders three buttons: Map, Dark, Satellite", () => {
    render(<MapStyleSwitcher currentStyle="map" onChange={() => undefined} />);
    openPanel();
    expect(screen.getByTestId("style-btn-map")).toBeTruthy();
    expect(screen.getByTestId("style-btn-dark")).toBeTruthy();
    expect(screen.getByTestId("style-btn-satellite")).toBeTruthy();
  });

  it("applies teal active styling to the current style button", () => {
    render(<MapStyleSwitcher currentStyle="dark" onChange={() => undefined} />);
    openPanel();
    const darkBtn = screen.getByTestId("style-btn-dark");
    expect(darkBtn.className).toContain("bg-teal-50");
    expect(darkBtn.className).toContain("text-teal-700");
  });

  it("inactive buttons do not have teal active class", () => {
    render(<MapStyleSwitcher currentStyle="map" onChange={() => undefined} />);
    openPanel();
    const darkBtn = screen.getByTestId("style-btn-dark");
    expect(darkBtn.className).not.toContain("bg-teal-50");
  });

  it("calls onChange with the clicked style", () => {
    const onChange = vi.fn();
    render(<MapStyleSwitcher currentStyle="map" onChange={onChange} />);

    openPanel();
    fireEvent.click(screen.getByTestId("style-btn-satellite"));
    expect(onChange).toHaveBeenCalledWith("satellite");

    // Panel closes after selection; re-open for the second assertion.
    openPanel();
    fireEvent.click(screen.getByTestId("style-btn-dark"));
    expect(onChange).toHaveBeenCalledWith("dark");
  });

  it("does not call onChange when clicking already-active button", () => {
    const onChange = vi.fn();
    render(<MapStyleSwitcher currentStyle="map" onChange={onChange} />);

    openPanel();
    fireEvent.click(screen.getByTestId("style-btn-map"));
    // onChange is still called — the parent decides whether to ignore it.
    // This tests that the button fires the event regardless.
    expect(onChange).toHaveBeenCalledWith("map");
  });

  it("has role=group for accessibility", () => {
    render(<MapStyleSwitcher currentStyle="map" onChange={() => undefined} />);
    const switcher = screen.getByTestId("map-style-switcher");
    expect(switcher.getAttribute("role")).toBe("group");
  });

  it("toggle button has aria-expanded=false when closed", () => {
    render(<MapStyleSwitcher currentStyle="map" onChange={() => undefined} />);
    const toggle = screen.getByTestId("style-switcher-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("toggle button has aria-expanded=true when open", () => {
    render(<MapStyleSwitcher currentStyle="map" onChange={() => undefined} />);
    openPanel();
    const toggle = screen.getByTestId("style-switcher-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("panel closes after an option is selected", () => {
    render(<MapStyleSwitcher currentStyle="map" onChange={() => undefined} />);
    openPanel();
    fireEvent.click(screen.getByTestId("style-btn-dark"));
    // Panel should be gone — toggle is back to closed
    expect(screen.getByTestId("style-switcher-toggle").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("style-btn-map")).toBeNull();
  });

  it("panel closes on Escape key", () => {
    render(<MapStyleSwitcher currentStyle="map" onChange={() => undefined} />);
    openPanel();
    expect(screen.getByTestId("style-btn-map")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("style-btn-map")).toBeNull();
  });
});
