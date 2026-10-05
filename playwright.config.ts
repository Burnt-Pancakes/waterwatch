import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

/**
 * Playwright config for WaterVoice DMV E2E.
 * A dev server is normally expected on Vite's port 8080. CI opts into a local
 * branch server so E2E does not depend on an unrelated hosting integration.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL,
    // Most tests exercise app behavior after the legally required first-use
    // acknowledgement. The disclaimer itself has dedicated component tests.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: new URL(baseURL).origin,
          localStorage: [{ name: "watervoice_disclaimer_accepted", value: "1" }],
        },
      ],
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 5"] } },
  ],
  webServer:
    process.env.PLAYWRIGHT_START_SERVER === "true"
      ? {
          command: "npm run dev -- --host 127.0.0.1 --port 8080",
          url: "http://127.0.0.1:8080",
          reuseExistingServer: false,
          timeout: 120_000,
        }
      : undefined,
});
