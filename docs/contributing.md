# Contributing

## Prerequisites

- Node.js 24 (exact version used in CI)
- npm (comes with Node.js)
- A Supabase project (or use the shared dev project if you have access)
- Optional: Anthropic API key (for AI explanation endpoint)

## Local Setup

```bash
git clone https://github.com/rajivsundar/dc-water-watch.git
cd dc-water-watch
npm install
cp .env.example .env
# Fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, etc.
npm run dev
```

## Git Workflow

1. Branch from `main`.
2. Make changes.
3. Run `npm test` — Vitest must pass with 90%+ coverage.
4. Run `npm run lint` and `npm run type-check`.
5. Commit — Husky pre-commit hook runs automatically.
6. Open a PR to `main`.

Branch names are free-form. The project uses Lovable for AI-assisted development so many commits originate from Lovable's session-based prompting.

## Husky Pre-Commit Hook

Husky is configured via the `prepare` script in `package.json`:

```json
"prepare": "husky"
```

The hook runs lint and format checks before every commit. If the hook fails, fix the issue and commit again — do not bypass with `--no-verify` unless you have an explicit reason.

## Code Standards

From `.lovable/CLAUDE.md`:

1. Map is fully public — no auth to view water quality.
2. Auth gates only favorites, alerts, account management.
3. All browser-only code must be in `useEffect` or guarded by `typeof window !== 'undefined'` (SSR requirement).
4. Supabase default secure storage + RLS as trust boundary.
5. RLS on every table — never bypass.
6. JSDoc on every function explaining purpose and params.
7. Inline comments on complex logic explaining WHY.
8. Vitest unit tests alongside every module — 90% coverage.
9. Mobile-first, verified at 390px width.
10. Dark mode via Tailwind `dark:` prefix.

## Safety-Critical Code

`src/lib/waterQualityEngine.ts` is SAFETY-CRITICAL. This code informs whether a member of the public will enter water that may contain pathogens.

Rules for changes to this file:
- Do NOT introduce network calls, randomness, mutable globals, or non-deterministic logic.
- Do NOT change threshold constants without citing the specific regulation that justifies the change.
- Every function must remain pure (same inputs → same outputs, always).
- Any change must include updated tests that verify boundary conditions.

## Adding a New Adapter

1. Create `src/lib/adapters/mySourceAdapter.ts` implementing `DataSourceAdapter`.
2. Export `sourceId`, `displayName`, `fetchSites()`, `fetchReadings()`, `normalize()`.
3. Add an injectable `fetchImpl` constructor parameter for testability.
4. Add a corresponding `*.test.ts` file testing `normalize`, any parsing helpers, and the adapter in isolation (mocking `fetchImpl`).
5. Register the adapter in `buildDefaultAdapters()` in `src/lib/ingest.server.ts`.
6. Add the `sourceId` to `ADAPTER_FILTER_IDS` in the same file.
7. Add the `kind` to the `auth_rate_limits.kind` CHECK constraint in a new migration if using the API rate-limit table.

## Adding a New Site Type

1. Add the value to the `site_type` CHECK constraint in a new Supabase migration.
2. Update the TypeScript union in `src/lib/adapters/base.ts` (`AdapterSite.siteType`).
3. Update `osmTagsToSiteType` in `osmPoiAdapter.ts` if the type has an OSM mapping.
4. Add a filter option to `FILTER_OPTIONS` in `src/components/map/filterSites.ts`.
5. Add an icon mapping in `src/components/map/siteMarkerConstants.ts`.

## Database Migrations

Create a new `.sql` file in `supabase/migrations/` with a timestamp prefix. Apply it with:

```bash
npx supabase db push
```

Or apply via the Supabase dashboard SQL editor. Migrations are applied in filename order.

## Disclaimer Rules

Every surface that displays water quality data must show the appropriate disclaimer from `DISCLAIMERS` in `waterQualityEngine.ts`. Do not invent new disclaimer text — use the centralized strings. If a new disclaimer is needed, add it to `DISCLAIMERS` and update the tests.
