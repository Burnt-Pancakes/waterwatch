# Deployment

## Hosting Stack

| Component              | Platform                                                |
| ---------------------- | ------------------------------------------------------- |
| Web app (SSR + static) | Lovable Cloud (Cloudflare Worker + static assets)       |
| Database               | Supabase (Postgres, managed on AWS us-east-1)           |
| Auth                   | Supabase Auth                                           |
| File storage           | Supabase Storage (bucket `arlington-data`)              |
| Scenic routing graph   | Versioned static assets on the Lovable application host |
| Email                  | Resend                                                  |
| Map tiles              | OpenFreeMap (`tiles.openfreemap.org`)                   |
| Edge functions         | Supabase Edge Functions (Deno)                          |

## CI Pipeline

**File:** `.github/workflows/ci.yml`

Runs on every push to `main` and every pull request to `main`. Node.js version: **24**.

### Jobs

**1. `lint` — Lint, type-check & production build** (parallel)

- `npm run lint` (ESLint)
- `npm run type-check` (TypeScript, no emit)
- `npm run build` (Lovable/Cloudflare production bundle)

**2. `unit-tests` — Unit tests & coverage** (parallel with `lint`)

- `npm test` (Vitest with `--coverage`)
- Uploads coverage report as a GitHub Actions artifact (retained 7 days)
- Vitest enforces 90% thresholds on lines, functions, branches, statements

**3. `e2e-tests` — E2E tests** (runs after both `lint` and `unit-tests`, PRs only)

- Installs Playwright with Chromium only
- Starts the current branch locally through Vite
- Runs `npm run test:e2e` without depending on a second hosting provider
- Uploads Playwright report on failure (retained 7 days)

**4. `coverage-comment` — Coverage PR comment** (runs after `unit-tests`, PRs only)

- Downloads the coverage artifact
- Posts a coverage summary table as a PR comment using `davelosert/vitest-coverage-report-action`

### Secrets used in CI

| Secret                      | Used by               |
| --------------------------- | --------------------- |
| `SUPABASE_URL`              | E2E app server        |
| `SUPABASE_SERVICE_ROLE_KEY` | E2E app server        |
| `SUPABASE_ANON_KEY`         | E2E app server        |
| `E2E_TEST_EMAIL`            | Playwright auth tests |
| `E2E_TEST_PASSWORD`         | Playwright auth tests |

## Production Deploy

Lovable is the primary host. Merging to the connected default branch syncs the
reviewed commit into Lovable; publishing promotes its Cloudflare Worker and
static assets together. The live URL is `dc-water-watch.lovable.app`.

Scenic-routing releases require no separate Supabase deployment. The reviewed
graph manifest and shards live under `public/routing-v2/<version>/`, and
`POST /api/route-v2` is deployed with the same application commit. Safe
database changes are expressed entirely as timestamped files under
`supabase/migrations/`. Do not add a manual Storage upload or routing-version
secret to this release path.

At runtime the Worker reads graph files from its generated `ASSETS` binding;
it does not make a network request back to its own public hostname.

## Environment Variables

See `.env.example` for the full list. In Lovable Cloud, these are stored in the project's Secrets panel.

| Variable                        | Required | Notes                                 |
| ------------------------------- | -------- | ------------------------------------- |
| `VITE_SUPABASE_URL`             | Yes      | Public Supabase project URL           |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes      | Public browser key                    |
| `SUPABASE_SERVICE_ROLE_KEY`     | Yes      | Server-only — never exposed to client |
| `RESEND_API_KEY`                | Yes      | Email sending                         |
| `RESEND_FROM_EMAIL`             | Yes      | Sender address                        |
| `VITE_SITE_URL`                 | Yes      | Full app URL (used for auth redirect) |
| `ANTHROPIC_API_KEY`             | Yes      | AI explanation endpoint               |
| `CRON_SECRET`                   | Yes      | Ingest endpoint authentication        |
| `VITE_MAP_TILE_URL`             | No       | Defaults to OpenFreeMap Liberty       |
| `VITE_MAP_TILE_URL_DARK`        | No       | Defaults to OpenFreeMap Liberty Dark  |

## Database Migrations

Migrations are committed as ordered, timestamped files under `supabase/migrations/`. There are 25 migration files; they must be applied in order. With Lovable Test and Live environments enabled, Lovable Cloud applies safe schema migrations as part of publishing. For manual environments, use `supabase db push` or the Supabase dashboard SQL editor.

Notable recent migrations:
- `20260711000001_rain_events_add_24h.sql` — adds `precipitation_inches_24h` column to `rain_events`
- `20260715000000_use_routed_trip_distances.sql` — scenic routing trip distances (idempotent, no seed data required)

## Ingestion Cron

Data ingestion is triggered by Supabase `pg_cron` calling `pg_net.http_post` against `POST /api/public/ingest`. The cron secret is stored in the Supabase environment and passed as `Authorization: Bearer <CRON_SECRET>`.

To run a specific adapter only, POST with body `{ "sourceId": "noaa_rain" }`.

## PWA

The app ships as a Progressive Web App. The manifest is at `public/manifest.json`:
- Name: `WaterWatch`
- Short name: `WaterWatch`
- Display: `standalone`
- Theme color: `#00695C`
- Icons: 192×192 and 512×512 (maskable)

The `InstallPrompt` component triggers the native add-to-home-screen dialog after the user's 3rd visit.
