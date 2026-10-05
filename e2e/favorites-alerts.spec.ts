import { test, expect } from "@playwright/test";

// Authenticated favorites/alerts tests require a pre-seeded test account.
const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? "";
const TEST_PASS = process.env.E2E_TEST_PASSWORD ?? "";

/** Sign in and return to the homepage, ready for map interaction. */
async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/auth/sign-in");
  await page.getByTestId("signin-email").fill(TEST_EMAIL);
  await page.getByTestId("signin-password").fill(TEST_PASS);
  await page.getByTestId("signin-submit").click();
  await expect(page).toHaveURL("/", { timeout: 15_000 });
}

// ── Unauthenticated tests (no login required) ─────────────────────────────

test.describe("Guest alert form (unauthenticated)", () => {
  test("guest alert email input -> confirmation shown", async ({ page }) => {
    await page.route("**/api/guest-alert", (route) =>
      route.fulfill({ status: 201, body: JSON.stringify({ ok: true }) }),
    );

    await page.goto("/");
    await page.getByTestId("site-marker").first().waitFor({ timeout: 10_000 });
    await page.getByTestId("site-marker").first().click();
    await expect(page.getByTestId("guest-alert-form")).toBeVisible();

    await page.getByTestId("guest-alert-email").fill("tester@example.com");
    await page.getByTestId("guest-alert-submit").click();
    await expect(page.getByTestId("guest-alert-success")).toBeVisible({ timeout: 5_000 });
  });
});

// ── Authenticated favorites / alert tests ─────────────────────────────────

test.describe("Favorites and alerts (authenticated)", () => {
  test.beforeEach(async ({ page }) => {
    if (!TEST_EMAIL || !TEST_PASS) {
      test.skip(true, "E2E_TEST_EMAIL / E2E_TEST_PASSWORD not set");
    }
  });

  test("star a site -> appears on /favorites", async ({ page }) => {
    await signIn(page);

    // Open a site and star it.
    await page.getByTestId("site-marker").first().waitFor({ timeout: 10_000 });
    await page.getByTestId("site-marker").first().click();
    const sheet = page.getByTestId("site-bottom-sheet");
    await expect(sheet).toHaveAttribute("data-open", "true");

    const siteName = await sheet.locator("h2").first().textContent();

    await page.getByTestId("favorite-star").click();
    await expect(page.getByTestId("favorite-star")).toHaveAttribute("data-starred", "true", {
      timeout: 5_000,
    });

    // Navigate to /favorites and verify the site appears.
    await page.goto("/favorites");
    await expect(page.getByTestId("favorites-list")).toBeVisible({ timeout: 10_000 });
    await expect(
      page.locator('[data-testid="favorite-card"]').filter({ hasText: siteName ?? "" }),
    ).toBeVisible();
  });

  test("unstar -> removed from /favorites", async ({ page }) => {
    await signIn(page);

    // Open a site, star it, then immediately unstar it.
    await page.getByTestId("site-marker").first().waitFor({ timeout: 10_000 });
    await page.getByTestId("site-marker").first().click();
    await expect(page.getByTestId("site-bottom-sheet")).toHaveAttribute("data-open", "true");

    const siteName = await page
      .getByTestId("site-bottom-sheet")
      .locator("h2")
      .first()
      .textContent();

    // Star — wait for confirmation.
    await page.getByTestId("favorite-star").click();
    await expect(page.getByTestId("favorite-star")).toHaveAttribute("data-starred", "true", {
      timeout: 5_000,
    });

    // Unstar.
    await page.getByTestId("favorite-star").click();
    await expect(page.getByTestId("favorite-star")).toHaveAttribute("data-starred", "false", {
      timeout: 5_000,
    });

    // Navigate to /favorites — site should not be present.
    await page.goto("/favorites");
    // Either the list is empty or the site is not in it.
    const card = page.locator('[data-testid="favorite-card"]').filter({ hasText: siteName ?? "" });
    await expect(card).toHaveCount(0, { timeout: 10_000 });
  });

  test("bell icon -> alert modal opens", async ({ page }) => {
    await signIn(page);
    await page.goto("/favorites");

    // The AlertBell is shown per-favorite-card on the /favorites page.
    const firstCard = page.getByTestId("favorite-card").first();
    if ((await firstCard.count()) === 0) {
      test.skip(true, "No favorited sites — run 'star a site' test first");
      return;
    }

    await firstCard.getByRole("button", { name: /alert/i }).click();
    // The dialog should open.
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 3_000 });
  });

  test("configure alert -> saved (toast shown)", async ({ page }) => {
    await signIn(page);

    // Open a site's alert modal via the 'Set alert' button in the sheet.
    await page.getByTestId("site-marker").first().waitFor({ timeout: 10_000 });
    await page.getByTestId("site-marker").first().click();
    await expect(page.getByTestId("site-bottom-sheet")).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("set-alert-button")).toBeVisible();
    await page.getByTestId("set-alert-button").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Submit with default trigger options.
    await dialog.getByRole("button", { name: /save/i }).click();
    // A success toast is shown on save.
    await expect(page.locator("[data-sonner-toast]")).toBeVisible({ timeout: 5_000 });
  });
});
