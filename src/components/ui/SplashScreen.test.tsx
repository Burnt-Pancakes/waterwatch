// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { SplashScreen } from "./SplashScreen";

afterEach(() => {
  cleanup();
});

describe("SplashScreen", () => {
  it("renders when isVisible is true", () => {
    const { getByText } = render(<SplashScreen isVisible={true} />);
    expect(getByText("WaterVoice DMV")).toBeTruthy();
  });

  it("has opacity-0 class when isVisible is false", () => {
    const { container } = render(<SplashScreen isVisible={false} />);
    // The outer div should have opacity-0 while still mounted (transition in progress)
    const div = container.firstChild as HTMLElement;
    expect(div).toBeTruthy();
    expect(div.className).toContain("opacity-0");
  });

  it("contains 'WaterVoice DMV' text", () => {
    const { getAllByText } = render(<SplashScreen isVisible={true} />);
    const elements = getAllByText("WaterVoice DMV");
    expect(elements.length).toBeGreaterThan(0);
  });
});
