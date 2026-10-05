import { test, expect } from "@playwright/test";

test.describe("WaterVoice DMV homepage map", () => {
  test("homepage renders without a blank screen and shows MapSkeleton during SSR", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await context.newPage();
    try {
      const response = await page.goto("/");
      expect(response?.ok()).toBe(true);

      const html = (await response?.text()) ?? "";
      // SSR markup must include the skeleton, not a blank body.
      expect(html).toContain('data-testid="watervoice-map-skeleton"');

      const skeleton = page.getByTestId("watervoice-map-skeleton");
      await expect(skeleton).toBeVisible();
      const box = await skeleton.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThan(100);
    } finally {
      await context.close();
    }
  });

  test("map loads within 3 seconds on desktop viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const t0 = Date.now();
    await page.goto("/");
    await expect(page.getByTestId("watervoice-map")).toBeVisible({ timeout: 3000 });
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  test("all 4 seed sites visible as markers after load", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("watervoice-map")).toBeVisible();
    await expect
      .poll(async () => page.getByTestId("site-marker").count(), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(4);
  });

  test("clicking a marker opens the bottom sheet", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("site-marker").first().waitFor();
    const t0 = Date.now();
    await page.getByTestId("site-marker").first().click();
    const sheet = page.getByTestId("site-bottom-sheet");
    await expect(sheet).toHaveAttribute("data-open", "true");
    expect(Date.now() - t0).toBeLessThan(500);
  });

  test("PASS site shows green badge and no stale banner", async ({ page }) => {
    await page.goto("/");
    const passMarker = page.locator('[data-testid="site-marker"][data-status="pass"]').first();
    await passMarker.waitFor();
    await passMarker.click();
    const badge = page.getByTestId("status-badge");
    await expect(badge).toHaveAttribute("data-status", "pass");
    await expect(page.getByTestId("stale-banner")).toHaveCount(0);
  });

  test("View full details expands sheet and shows trend chart", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("site-marker").first().waitFor();
    await page.getByTestId("site-marker").first().click();
    await page.getByTestId("view-details-button").click();
    await expect(page.getByTestId("sheet-expanded-content")).toBeVisible();
    await expect(page.getByTestId("trend-chart")).toBeVisible();
    await expect(page.getByTestId("site-bottom-sheet")).toHaveAttribute("data-expanded", "true");
  });

  test("close button dismisses the sheet", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("site-marker").first().waitFor();
    await page.getByTestId("site-marker").first().click();
    await expect(page.getByTestId("site-bottom-sheet")).toHaveAttribute("data-open", "true");
    await page.getByLabel("Close site details").click();
    await expect(page.getByTestId("site-bottom-sheet")).toHaveAttribute("data-open", "false");
  });

  test("filtering to Kayak only shows kayak_launch markers", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("site-marker").first().waitFor();
    await page.getByTestId("filter-kayak_launch").click();
    const types = await page
      .getByTestId("site-marker")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-site-type")));
    expect(types.length).toBeGreaterThan(0);
    for (const t of types) expect(t).toBe("kayak_launch");
  });

  test("filter pill 'All' restores all markers after a type filter", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("site-marker").first().waitFor();
    const totalBefore = await page.getByTestId("site-marker").count();

    await page.getByTestId("filter-kayak_launch").click();
    const afterKayak = await page.getByTestId("site-marker").count();
    // There may be fewer kayak markers than the total.
    expect(afterKayak).toBeGreaterThan(0);

    await page.getByTestId("filter-all").click();
    await expect
      .poll(() => page.getByTestId("site-marker").count(), { timeout: 5_000 })
      .toBe(totalBefore);
  });

  test("'Locate me' button shows user-location dot after geolocation grant", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 38.9072, longitude: -77.0369 });

    await page.goto("/");
    await expect(page.getByTestId("watervoice-map")).toBeVisible();
    await page.getByTestId("site-marker").first().waitFor();

    await page.getByTestId("locate-me").click();
    await expect(page.getByTestId("user-location")).toBeVisible({ timeout: 5_000 });
  });

  test("dark mode toggle switches map tiles to dark variant", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("watervoice-map")).toBeVisible();

    // Capture the next tile-style request after switching to dark mode.
    const darkRequest = page.waitForRequest(
      (req) => req.url().includes("dark") && req.resourceType() === "fetch",
      { timeout: 10_000 },
    );
    await page.emulateMedia({ colorScheme: "dark" });
    const req = await darkRequest;
    expect(req.url()).toMatch(/dark/i);
  });
});
