import { test, expect } from "@playwright/test";

// Full auth-flow tests (sign-in, sign-out) require a pre-seeded test account.
// Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD in GitHub Actions secrets.
const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? "";
const TEST_PASS = process.env.E2E_TEST_PASSWORD ?? "";

test.describe("Authentication", () => {
  // ── Client-side validation (no server needed) ────────────────────────────

  test("sign up with weak password -> inline error shown", async ({ page }) => {
    await page.goto("/auth/sign-up");
    await page.getByTestId("signup-email").fill("user@example.com");
    await page.getByTestId("signup-password").fill("short");
    await page.getByRole("button", { name: /create account/i }).click();
    // validatePassword runs client-side; error renders before any network call.
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 2_000 });
  });

  // ── Protected route ───────────────────────────────────────────────────────

  test("/favorites without auth -> redirected to /auth/sign-in", async ({ page }) => {
    await page.goto("/favorites");
    await expect(page).toHaveURL(/\/auth\/sign-in/, { timeout: 5_000 });
  });

  // ── Server-side auth errors (real Supabase, safe wrong creds) ────────────

  test("sign in with wrong password -> error shown", async ({ page }) => {
    await page.goto("/auth/sign-in");
    await page.getByTestId("signin-email").fill("nobody@nowhere.invalid");
    await page.getByTestId("signin-password").fill("definitelywrong99!");
    await page.getByTestId("signin-submit").click();
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 15_000 });
  });

  test("forgot password -> sends reset email state shown", async ({ page }) => {
    await page.goto("/auth/reset-password");
    await page.getByTestId("reset-email").fill("ghost@example.com");
    await page.getByRole("button", { name: /send reset link/i }).click();
    // Supabase silently accepts any email; the UI shows the confirmation state.
    await expect(page.getByTestId("reset-sent")).toBeVisible({ timeout: 15_000 });
  });

  // ── Sign-up with valid credentials (mocked server response) ──────────────

  test("sign up with valid email + strong password -> verification email state shown", async ({
    page,
  }) => {
    // Intercept the TanStack Start server-function POST so we don't hit Supabase.
    await page.route("**/_server**", async (route) => {
      const body = (await route.request().postDataJSON()) as Record<string, unknown>;
      // TanStack Start encodes the function identifier in the request body.
      const id = String(body.id ?? body.fnId ?? "");
      if (id.includes("signUpUser") || id.includes("sign-up")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ email: "new@example.com" }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/auth/sign-up");
    await page.getByTestId("signup-email").fill("new@example.com");
    await page.getByTestId("signup-password").fill("StrongPass1!");
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page.getByTestId("signup-success")).toBeVisible({ timeout: 5_000 });
  });

  test("sign up with existing email -> error shown", async ({ page }) => {
    // Intercept and return the "already registered" error that Supabase emits.
    await page.route("**/_server**", async (route) => {
      const body = (await route.request().postDataJSON()) as Record<string, unknown>;
      const id = String(body.id ?? body.fnId ?? "");
      if (id.includes("signUpUser") || id.includes("sign-up")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          // TanStack Start propagates thrown errors as a 200 with an error envelope.
          body: JSON.stringify({ error: "User already registered" }),
        });
      } else {
        await route.continue();
      }
    });

    // Make the server function throw from the client perspective.
    await page.addInitScript(() => {
      // Monkey-patch fetch so the server-fn response triggers the catch block.
      const _fetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const res = await _fetch(input, init);
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.includes("_server")) {
          const clone = res.clone();
          const json = (await clone.json()) as Record<string, unknown>;
          if (json.error) {
            return new Response(JSON.stringify({ message: String(json.error) }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
        }
        return res;
      };
    });

    await page.goto("/auth/sign-up");
    await page.getByTestId("signup-email").fill("existing@example.com");
    await page.getByTestId("signup-password").fill("StrongPass1!");
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page.getByTestId("signup-error")).toBeVisible({ timeout: 5_000 });
  });

  // ── Full auth flow (requires test credentials via env vars) ───────────────

  test("sign in -> /favorites accessible", async ({ page }) => {
    if (!TEST_EMAIL || !TEST_PASS) {
      test.skip(true, "E2E_TEST_EMAIL / E2E_TEST_PASSWORD not set");
      return;
    }
    await page.goto("/auth/sign-in");
    await page.getByTestId("signin-email").fill(TEST_EMAIL);
    await page.getByTestId("signin-password").fill(TEST_PASS);
    await page.getByTestId("signin-submit").click();
    // Sign-in redirects to "/" on success.
    await expect(page).toHaveURL("/", { timeout: 15_000 });

    // Now navigate to /favorites — should NOT redirect.
    await page.goto("/favorites");
    await expect(page).not.toHaveURL(/\/auth\/sign-in/);
  });

  test("sign out -> /favorites redirects to /auth/sign-in", async ({ page }) => {
    if (!TEST_EMAIL || !TEST_PASS) {
      test.skip(true, "E2E_TEST_EMAIL / E2E_TEST_PASSWORD not set");
      return;
    }
    // Sign in first.
    await page.goto("/auth/sign-in");
    await page.getByTestId("signin-email").fill(TEST_EMAIL);
    await page.getByTestId("signin-password").fill(TEST_PASS);
    await page.getByTestId("signin-submit").click();
    await expect(page).toHaveURL("/", { timeout: 15_000 });

    // Sign out via the AuthNav button.
    await page.getByRole("button", { name: /sign out/i }).click();

    // After sign-out, /favorites must redirect back to sign-in.
    await page.goto("/favorites");
    await expect(page).toHaveURL(/\/auth\/sign-in/, { timeout: 5_000 });
  });
});
