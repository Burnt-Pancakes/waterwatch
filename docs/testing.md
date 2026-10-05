# Testing

## Summary

| Type | Tool | Count (as of last run) |
|---|---|---|
| Unit / integration | Vitest 4.x | 443 tests, 51 test files |
| E2E | Playwright 1.60.x | See `tests/e2e/` |

Run unit tests: `npm test` (also generates coverage)
Run in watch mode: `npm run test:watch`
Run E2E: `npm run test:e2e`

---

## Vitest Configuration

**File:** `vitest.config.ts`

```typescript
{
  environment: "node",
  globals: false,
  include: [
    "tests/**/*.test.ts",
    "src/**/*.test.ts",
    "src/**/*.test.tsx"
  ],
  coverage: {
    provider: "v8",
    reporter: ["text", "html", "lcov", "json-summary"],
    include: ["src/lib/**/*.ts"],
    exclude: [
      "**/*.spec.ts",
      "**/seed/**",
      "**/migrations/**",
      "src/types/**",
      "src/integrations/**"
    ],
    thresholds: {
      lines: 90,
      functions: 90,
      branches: 90,
      statements: 90
    }
  }
}
```

Coverage is collected only for `src/lib/**/*.ts`. Seed data, type definitions, Supabase integration files, and spec files are excluded.

The 90% threshold is enforced by Vitest — CI exits non-zero if any threshold is missed.

---

## Test File Locations

Tests live alongside the module they test (co-located pattern):

- `src/lib/waterQualityEngine.ts` → `src/lib/waterQualityEngine.test.ts` (decision engine)
- `src/lib/ingest.server.ts` → `src/lib/ingest.server.test.ts`
- `src/lib/adapters/usgsWqpAdapter.ts` → `src/lib/adapters/usgsWqpAdapter.test.ts`
- `src/lib/adapters/arlingtonCountyAdapter.ts` → `src/lib/adapters/arlingtonCountyAdapter.test.ts`
- `src/lib/adapters/noaaRainAdapter.ts` → `src/lib/adapters/noaaRainAdapter.test.ts`
- `src/lib/adapters/osmPoiAdapter.ts` → `src/lib/adapters/osmPoiAdapter.test.ts`
- `src/lib/adapters/marylandDNRAdapter.ts` → `src/lib/adapters/marylandDNRAdapter.coverage.test.ts`
- `src/lib/auth/passwordValidation.ts` → `src/lib/auth/passwordValidation.test.ts`
- `src/components/map/WaterVoiceMap.tsx` → `src/components/map/WaterVoiceMap.test.tsx`
- `src/components/map/SiteBottomSheet.tsx` → `src/components/map/SiteBottomSheet.test.tsx`
- `src/components/ui/BottomTabBar.tsx` → `src/components/ui/BottomTabBar.test.tsx`
- `src/components/ui/FirstUseDisclaimer.tsx` → `src/components/ui/FirstUseDisclaimer.test.tsx`
- `src/components/ui/InstallPrompt.tsx` → `src/components/ui/InstallPrompt.test.tsx`
- DB integration tests → `tests/db/` (requires Supabase credentials)

---

## Coverage Report

Coverage is written to `coverage/` with text, HTML, LCOV, JSON summary, and JSON
detail reporters. In CI, the coverage JSON is uploaded as an artifact and posted
as a PR comment via `davelosert/vitest-coverage-report-action`.

---

## DB Integration Tests

Tests in `tests/db/` run only when `RUN_DB_INTEGRATION_TESTS=true` and read
`SUPABASE_URL` plus `SUPABASE_SERVICE_ROLE_KEY` from `.env`. They stay skipped
during the ordinary unit suite even if local cloud credentials are present.

---

## E2E Tests (Playwright)

**Config:** `playwright.config.ts` (see file for browser matrix)

E2E tests run in CI only on pull requests. Playwright starts the current branch
locally and targets `PLAYWRIGHT_BASE_URL`, so test results do not depend on a
Vercel or other secondary-host preview.

Auth E2E tests in `auth.spec.ts` use `E2E_TEST_EMAIL` and `E2E_TEST_PASSWORD` secrets to test the full authenticated flow.

---

## Testing Patterns

**Adapter mocking:** Adapters accept a `fetchImpl` constructor parameter. Tests pass a function that returns canned JSON instead of calling the real API. The orchestrator accepts `overrideAdapters` for the same reason.

**SAFETY-CRITICAL module:** `waterQualityEngine.ts` is pure (no side effects). Every exported function is tested with boundary conditions. Tests enforce hard rules: no "100% safe" language, no "will not get sick" claims, correct handling of null inputs, stale boundaries, rain thresholds.

**Component tests:** Use `@testing-library/react` with `jsdom` environment. Browser globals (`localStorage`, `matchMedia`, `navigator.share`) are mocked per test.
