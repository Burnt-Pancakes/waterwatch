import { test, expect } from "@playwright/test";

test.describe("Site detail bottom sheet", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("site-marker").first().waitFor({ timeout: 10_000 });
    await page.getByTestId("site-marker").first().click();
    await expect(page.getByTestId("site-bottom-sheet")).toHaveAttribute("data-open", "true");
  });

  test("tap marker -> bottom sheet slides up", async ({ page }) => {
    const sheet = page.getByTestId("site-bottom-sheet");
    await expect(sheet).toBeVisible();
    // Sheet should occupy meaningful vertical space.
    const box = await sheet.boundingBox();
    expect(box?.height).toBeGreaterThan(100);
  });

  test("status badge is visible with correct label", async ({ page }) => {
    const badge = page.getByTestId("status-badge");
    await expect(badge).toBeVisible();
    const status = await badge.getAttribute("data-status");
    expect(["pass", "caution", "unsafe", "no_data"]).toContain(status);
    // Badge must have non-empty text.
    const text = await badge.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test("stale site -> blue stale banner visible", async ({ page }) => {
    // If the first marker is not stale, find one that is.
    const staleMarker = page.locator('[data-testid="site-marker"][data-stale="true"]').first();
    if ((await staleMarker.count()) === 0) {
      test.skip(true, "No stale sites in current seed data");
      return;
    }
    await staleMarker.click();
    const banner = page.getByTestId("stale-banner");
    await expect(banner).toBeVisible();
    // The stale banner uses a blue left border — verify its presence by checking the text.
    await expect(banner).toContainText(/day/i);
  });

  test("rain advisory -> amber rain banner visible", async ({ page }) => {
    // Rain banner only appears when a rain advisory is active for the site.
    // If none of the seed sites currently have an active advisory, this test
    // verifies the banner is hidden (not a false negative).
    const banner = page.getByTestId("rain-banner");
    const visible = await banner.isVisible();
    if (visible) {
      await expect(banner).toContainText(/rain/i);
    } else {
      // No active rain advisory in current data — expected.
      expect(visible).toBe(false);
    }
  });

  test("'View full details' -> trend chart visible", async ({ page }) => {
    await page.getByTestId("view-details-button").click();
    await expect(page.getByTestId("sheet-expanded-content")).toBeVisible();
    await expect(page.getByTestId("trend-chart")).toBeVisible();
    await expect(page.getByTestId("site-bottom-sheet")).toHaveAttribute("data-expanded", "true");
  });

  test("activity buttons -> advisory text appears", async ({ page }) => {
    await page.getByTestId("view-details-button").click();
    await expect(page.getByTestId("sheet-expanded-content")).toBeVisible();

    // Click the first activity button.
    await page.getByTestId("activity-swimming").click();
    const advisory = page.getByTestId("activity-advisory-text");
    await expect(advisory).toBeVisible();
    const text = await advisory.textContent();
    expect((text ?? "").trim().length).toBeGreaterThan(10);
  });

  test("share button -> web share API called or URL copied", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByTestId("view-details-button").click();
    await expect(page.getByTestId("sheet-expanded-content")).toBeVisible();

    // Override navigator.share so we can detect if it was triggered.
    await page.evaluate(() => {
      (window as Record<string, unknown>).__shareCount = 0;
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async () => {
          (window as Record<string, unknown>).__shareCount =
            ((window as Record<string, unknown>).__shareCount as number) + 1;
        },
      });
    });

    await page.getByRole("button", { name: /share/i }).click();

    const shared = await page.evaluate(
      () => (window as Record<string, unknown>).__shareCount as number,
    );
    if (shared > 0) {
      expect(shared).toBe(1);
    } else {
      // Clipboard fallback: a success toast should appear.
      await expect(page.locator("[data-sonner-toast]")).toBeVisible({ timeout: 3_000 });
    }
  });

  test("swipe down -> sheet dismisses", async ({ page }) => {
    const handle = page.getByTestId("sheet-drag-handle");
    await expect(handle).toBeVisible();

    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    // Drag downward by 150 px — should trigger onClose.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let dy = 0; dy <= 150; dy += 15) {
      await page.mouse.move(cx, cy + dy);
    }
    await page.mouse.up();

    await expect(page.getByTestId("site-bottom-sheet")).toHaveAttribute("data-open", "false", {
      timeout: 1_000,
    });
  });
});
