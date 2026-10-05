import { expect, test, type Page } from "@playwright/test";

const plannerSites = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Key Bridge Boathouse",
    slug: "key-bridge-boathouse",
    lat: 38.90416,
    lng: -77.06969,
    site_type: "kayak_launch",
    is_tidal: true,
    tidal_gauge_station_id: "8594900",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Gravelly Point Boat Ramp",
    slug: "gravelly-point-boat-ramp",
    lat: 38.863958,
    lng: -77.04108,
    site_type: "boat_ramp",
    is_tidal: true,
    tidal_gauge_station_id: "8594900",
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    name: "River Bend Park Boat Ramp",
    slug: "river-bend-park-boat-ramp",
    lat: 39.018236,
    lng: -77.245606,
    site_type: "boat_ramp",
    is_tidal: true,
    tidal_gauge_station_id: "8594900",
  },
];

async function openPlanner(page: Page) {
  await page.route("**/rest/v1/sites**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Content-Range": `0-${plannerSites.length - 1}/${plannerSites.length}` },
      body: JSON.stringify(plannerSites),
    }),
  );
  await page.goto("/plan");
  await expect(page.getByTestId("plan-site-search")).toBeVisible();
}

async function chooseWaypoint(page: Page, name: string) {
  const search = page.getByTestId("plan-site-search");
  await search.fill(name);
  await page.getByRole("button", { name, exact: true }).click();
}

async function addDestination(page: Page, name: string) {
  await page.getByRole("button", { name: /add waypoint/i }).click();
  await chooseWaypoint(page, name);
}

test.describe("Scenic water routing planner", () => {
  test("verified water distance drives the route summary and enables progression", async ({
    page,
  }) => {
    await page.route("**/api/route-v2", async (route) => {
      // Keep the request pending long enough to assert the gated loading state
      // even on a busy CI runner.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });
    await openPlanner(page);

    await chooseWaypoint(page, "Key Bridge Boathouse");
    await addDestination(page, "Gravelly Point Boat Ramp");

    const continueButton = page.getByTestId("find-windows-btn");
    await expect(continueButton).toBeDisabled();
    await expect(page.getByText("Finding a scenic water route…")).toBeVisible();

    const summary = page.getByText("Scenic water route").locator("..");
    await expect(summary).toBeVisible({ timeout: 15_000 });
    await expect(summary).toContainText(/\d+(?:\.\d+)? nm/);
    await expect(summary).toContainText(/Water graph dmv-core-2026-07-18/);
    await expect(continueButton).toBeEnabled();

    const map = page.getByTestId("trip-planner-map");
    await expect(map).toHaveAttribute("data-waypoint-count", "2");
    await expect
      .poll(async () => Number(await map.getAttribute("data-route-point-count")))
      .toBeGreaterThan(2);

    const panelFitsViewport = await page
      .getByTestId("route-builder-panel")
      .evaluate((panel) => panel.scrollWidth <= panel.clientWidth + 1);
    expect(panelFitsViewport).toBe(true);
  });

  test("an impossible leg keeps pins, removes route geometry, and gates progression", async ({
    page,
  }) => {
    await openPlanner(page);

    await chooseWaypoint(page, "River Bend Park Boat Ramp");
    await addDestination(page, "Key Bridge Boathouse");

    const alert = page.getByRole("alert").filter({ hasText: "No verified all-water route" });
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert).toContainText("Leg 1:");
    await expect(alert).toContainText("No direct line will be used");
    await expect(page.getByTestId("find-windows-btn")).toBeDisabled();
    await expect(page.getByText("River Bend Park Boat Ramp", { exact: true })).toBeVisible();
    await expect(page.getByText("Key Bridge Boathouse", { exact: true })).toBeVisible();

    const map = page.getByTestId("trip-planner-map");
    await expect(map).toHaveAttribute("data-waypoint-count", "2");
    await expect(map).toHaveAttribute("data-route-point-count", "0");

    const panelFitsViewport = await page
      .getByTestId("route-builder-panel")
      .evaluate((panel) => panel.scrollWidth <= panel.clientWidth + 1);
    expect(panelFitsViewport).toBe(true);
  });
});
