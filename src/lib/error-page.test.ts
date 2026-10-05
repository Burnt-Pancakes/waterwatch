import { describe, expect, it } from "vitest";
import { renderErrorPage } from "./error-page";

describe("renderErrorPage", () => {
  it("returns a valid HTML string", () => {
    const html = renderErrorPage();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("</html>");
  });

  it("includes a 'Try again' reload button", () => {
    expect(renderErrorPage()).toContain("location.reload()");
  });

  it("includes a 'Go home' link pointing to /", () => {
    const html = renderErrorPage();
    expect(html).toContain('href="/"');
    expect(html).toContain("Go home");
  });

  it("is deterministic across calls", () => {
    expect(renderErrorPage()).toBe(renderErrorPage());
  });
});
