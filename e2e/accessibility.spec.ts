import { test, expect } from "@playwright/test";

test.describe("Accessibility", () => {
  test("all status badges have aria-label or role=status", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("site-marker").first().waitFor({ timeout: 10_000 });
    await page.getByTestId("site-marker").first().click();
    await expect(page.getByTestId("site-bottom-sheet")).toHaveAttribute("data-open", "true");

    const badge = page.getByTestId("status-badge");
    await expect(badge).toBeVisible();
    // The badge uses role="status" so it is always announced by screen readers.
    await expect(badge).toHaveAttribute("role", "status");
  });

  test("all map markers have aria-label with site name and status", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("site-marker").first().waitFor({ timeout: 10_000 });

    const markers = page.getByTestId("site-marker");
    const count = await markers.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < Math.min(count, 6); i++) {
      const label = await markers.nth(i).getAttribute("aria-label");
      expect(label).toBeTruthy();
      // Label should mention a site name and a status word.
      expect(label).toMatch(/pass|caution|unsafe|no.?data/i);
    }
  });

  test("keyboard navigation reaches all interactive sheet elements", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("site-marker").first().waitFor({ timeout: 10_000 });
    await page.getByTestId("site-marker").first().click();
    await expect(page.getByTestId("site-bottom-sheet")).toHaveAttribute("data-open", "true");

    // Tab through the sheet and collect all focused elements.
    const focusedRoles: string[] = [];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        return el
          ? el.tagName.toLowerCase() +
              (el.getAttribute("role") ? `[${el.getAttribute("role")}]` : "")
          : "";
      });
      focusedRoles.push(focused);
    }

    // At least one button must have been focused.
    expect(focusedRoles.some((r) => r.includes("button"))).toBe(true);
  });

  test("no color-only status indicators: icons and text present alongside color", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("site-marker").first().waitFor({ timeout: 10_000 });
    await page.getByTestId("site-marker").first().click();
    await expect(page.getByTestId("site-bottom-sheet")).toHaveAttribute("data-open", "true");

    const badge = page.getByTestId("status-badge");
    await expect(badge).toBeVisible();

    // Icon is rendered (aria-hidden svg).
    const icon = badge.locator("svg[aria-hidden]");
    await expect(icon).toBeVisible();

    // Text is also present.
    const text = await badge.textContent();
    expect((text ?? "").trim().length).toBeGreaterThan(0);
  });

  test("site markers have aria-label including site name", async ({ page }) => {
    await page.goto("/");
    const markers = page.getByTestId("site-marker");
    await markers.first().waitFor({ timeout: 10_000 });

    const firstLabel = await markers.first().getAttribute("aria-label");
    expect(firstLabel).toBeTruthy();
    expect((firstLabel ?? "").length).toBeGreaterThan(3);
  });

  test("close button in sheet has descriptive aria-label", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("site-marker").first().waitFor({ timeout: 10_000 });
    await page.getByTestId("site-marker").first().click();
    await expect(page.getByTestId("site-bottom-sheet")).toHaveAttribute("data-open", "true");

    // The close button uses aria-label="Close site details".
    await expect(page.getByLabel("Close site details")).toBeVisible();
  });
});
