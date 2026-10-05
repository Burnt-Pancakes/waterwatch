import { test, expect } from "@playwright/test";

test.describe("Favorites and alerts", () => {
  test("unauthenticated user is redirected to sign-in when visiting /favorites", async ({
    page,
  }) => {
    const response = await page.goto("/favorites");
    // The protected layout redirects to sign-in; either a 302 or the final URL
    // contains /auth/sign-in.
    const url = page.url();
    expect(url).toContain("/auth/sign-in");
    // HTTP-level redirect may result in a 200 on the sign-in page.
    expect(response?.status()).toBeLessThan(400);
  });

  test("GuestAlertForm is visible on the map after opening a site", async ({ page }) => {
    await page.goto("/");
    // Wait for at least one marker to appear.
    await page.getByTestId("site-marker").first().waitFor({ timeout: 10_000 });
    await page.getByTestId("site-marker").first().click();

    // The bottom sheet opens for an unauthenticated user.
    await expect(page.getByTestId("site-bottom-sheet")).toHaveAttribute("data-open", "true");

    // GuestAlertForm should be visible since we are unauthenticated.
    await expect(page.getByTestId("guest-alert-form")).toBeVisible();
  });

  test("GuestAlertForm shows success after submitting a valid email", async ({ page }) => {
    // Intercept the /api/guest-alert POST to avoid real DB writes.
    await page.route("**/api/guest-alert", (route) =>
      route.fulfill({ status: 201, body: JSON.stringify({ ok: true }) }),
    );

    await page.goto("/");
    await page.getByTestId("site-marker").first().waitFor({ timeout: 10_000 });
    await page.getByTestId("site-marker").first().click();
    await expect(page.getByTestId("guest-alert-form")).toBeVisible();

    await page.getByTestId("guest-alert-email").fill("test@example.com");
    await page.getByTestId("guest-alert-submit").click();

    await expect(page.getByTestId("guest-alert-success")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("unsubscribe page renders an invalid-link message without JavaScript", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await context.newPage();
    try {
      // A missing token exercises the server-rendered response without
      // performing a database mutation.
      const response = await page.goto("/api/guest-alert/unsubscribe");
      expect(response?.ok()).toBe(true);
      const html = (await response?.text()) ?? "";
      expect(html.toLowerCase()).toContain("invalid link");
    } finally {
      await context.close();
    }
  });
});
