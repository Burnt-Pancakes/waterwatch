// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SkeletonCard } from "./SkeletonCard";

describe("SkeletonCard", () => {
  it("renders with animate-pulse class", () => {
    const { container } = render(<SkeletonCard />);
    expect(container.firstElementChild?.className).toContain("animate-pulse");
  });

  it("renders 3 lines by default", () => {
    const { container } = render(<SkeletonCard />);
    const lines = container.querySelectorAll("[class*='rounded-md']");
    expect(lines).toHaveLength(3);
  });

  it("renders the specified number of lines from props", () => {
    const { container } = render(<SkeletonCard lines={5} />);
    const lines = container.querySelectorAll("[class*='rounded-md']");
    expect(lines).toHaveLength(5);
  });

  it("applies custom className to the wrapper", () => {
    const { container } = render(<SkeletonCard className="custom-class" />);
    expect(container.firstElementChild?.className).toContain("custom-class");
  });

  it("is aria-hidden so screen readers skip the loading placeholder", () => {
    const { container } = render(<SkeletonCard />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });
});
