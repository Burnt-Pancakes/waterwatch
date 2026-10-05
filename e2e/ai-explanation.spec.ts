import { test, expect } from "@playwright/test";

/** Opens the first map site, expands the sheet, and returns to the page. */
async function openExpandedSheet(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByTestId("site-marker").first().waitFor({ timeout: 10_000 });
  await page.getByTestId("site-marker").first().click();
  await expect(page.getByTestId("site-bottom-sheet")).toHaveAttribute("data-open", "true");
  await page.getByTestId("view-details-button").click();
  await expect(page.getByTestId("sheet-expanded-content")).toBeVisible();
}

test.describe("AI explanation (streaming)", () => {
  test("'Ask WaterVoice AI' button -> loading indicator shown", async ({ page }) => {
    // Intercept /api/explain to stall the stream momentarily so we can see the
    // loading state before it resolves.
    await page.route("**/api/explain", async (route) => {
      // Delay the response so the loading indicator is visible.
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: 'data: {"text":"Safe for kayaking today."}\n\ndata: [DONE]\n\n',
      });
    });

    await openExpandedSheet(page);

    // Open the AI panel.
    await page.getByRole("button", { name: /ask watervoice ai/i }).click();

    // Click an activity to start the fetch.
    const loadingPromise = expect(page.getByTestId("loading-indicator")).toBeVisible({
      timeout: 5_000,
    });
    await page.getByTestId("activity-kayaking").first().click();
    await loadingPromise;
  });

  test("AI response appears within 10 seconds", async ({ page }) => {
    await page.route("**/api/explain", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: 'data: {"text":"Water quality looks good."}\n\ndata: [DONE]\n\n',
      }),
    );

    await openExpandedSheet(page);
    await page.getByRole("button", { name: /ask watervoice ai/i }).click();
    await page.getByTestId("activity-swimming").first().click();

    await expect(page.getByTestId("ai-response")).toBeVisible({ timeout: 10_000 });
    const text = await page.getByTestId("ai-response").textContent();
    expect((text ?? "").trim().length).toBeGreaterThan(0);
  });

  test("disclaimer text visible below response", async ({ page }) => {
    await page.route("**/api/explain", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: 'data: {"text":"Looks good."}\n\ndata: [DONE]\n\n',
      }),
    );

    await openExpandedSheet(page);
    await page.getByRole("button", { name: /ask watervoice ai/i }).click();
    await page.getByTestId("activity-wading").first().click();
    await expect(page.getByTestId("ai-response")).toBeVisible({ timeout: 10_000 });

    // The disclaimer paragraph follows the response inside the AI panel.
    await expect(page.locator("text=/not a regulatory determination/i").first()).toBeVisible();
  });

  test("after rate-limit -> 429 error shown gracefully", async ({ page }) => {
    await page.route("**/api/explain", (route) =>
      route.fulfill({
        status: 429,
        body: JSON.stringify({ error: "rate_limit_exceeded" }),
      }),
    );

    await openExpandedSheet(page);
    await page.getByRole("button", { name: /ask watervoice ai/i }).click();
    await page.getByTestId("activity-fishing").first().click();

    await expect(page.getByTestId("error-rate-limit")).toBeVisible({ timeout: 5_000 });
    // Page must not crash or show an unhandled error boundary.
    await expect(page.getByTestId("site-bottom-sheet")).toHaveAttribute("data-open", "true");
  });
});
