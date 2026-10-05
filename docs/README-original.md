# WaterWatch

WaterWatch is a civic water quality advisory app for the DC Metro area that answers one question for paddlers, kayakers, swimmers, and families: **Is it safe to get in the water today?** It pulls bacteria readings from EPA WQP, CMC (Chesapeake Monitoring Cooperative), USGS, Arlington County, and OpenStreetMap, runs them through an EPA 2012 RWQC decision engine, and surfaces a plain-language status (PASS / CAUTION / UNSAFE / NO DATA) on a full-screen map — no account required to view water quality.

**Live app:** https://dc-water-watch.lovable.app

---

## Quick Start

Requires **Node.js 24** and npm.

```bash
git clone https://github.com/rajivsundar/dc-water-watch.git
cd dc-water-watch
npm install

# Copy env template and fill in Supabase + optional keys
cp .env.example .env

# Start the dev server (TanStack Start + Vite)
npm run dev
```

The dev server starts at `http://localhost:8080` by default. The map is fully public; auth is only needed for favorites, alerts, and account management.

### Key scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm test` | Vitest unit tests with coverage |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm run type-check` | TypeScript (no emit) |

---

## Directory Guide

```
dc-water-watch/
├── src/
│   ├── routes/                  # TanStack Start file-based routes
│   │   ├── index.tsx            # Homepage (full-screen map)
│   │   ├── __root.tsx           # Root layout, BottomTabBar, disclaimers
│   │   ├── rivers.index.tsx     # /rivers — all non-tidal USGS gauges
│   │   ├── rivers.$gaugeId.tsx  # /rivers/:id — stage chart, readings, linked sites
│   │   ├── tides.tsx            # /tides — tidal curve, next tides, navigability
│   │   ├── auth/                # sign-in, sign-up, verify-email, callback, etc.
│   │   └── api/                 # Server-only API handlers
│   │       ├── sites.ts         # GET /api/sites (GeoJSON FeatureCollection)
│   │       ├── sites/[slug].ts  # GET /api/sites/:slug (site detail)
│   │       ├── sites/[slug]/readings.ts  # GET /api/sites/:slug/readings
│   │       ├── explain.ts       # POST /api/explain (AI streaming SSE)
│   │       ├── public/ingest.ts # POST /api/public/ingest (cron endpoint)
│   │       ├── guest-alert.ts   # POST /api/guest-alert (subscribe)
│   │       └── guest-alert/unsubscribe.ts  # GET unsubscribe
│   ├── lib/
│   │   ├── waterQualityEngine.ts  # SAFETY-CRITICAL: EPA decision engine
│   │   ├── ingest.server.ts     # Ingestion orchestrator
│   │   ├── auth.functions.ts    # TanStack server functions for auth
│   │   ├── auth/
│   │   │   ├── rateLimit.server.ts   # IP-based rate limiting
│   │   │   └── passwordValidation.ts # Shared Zod password/email schemas
│   │   ├── adapters/            # One adapter per external data source
│   │   │   ├── base.ts          # DataSourceAdapter interface + types
│   │   │   ├── usgsWqpAdapter.ts
│   │   │   ├── arlingtonCountyAdapter.ts
│   │   │   ├── noaaRainAdapter.ts
│   │   │   ├── osmPoiAdapter.ts
│   │   │   ├── openDataDCAdapter.ts  # Standby
│   │   │   ├── marylandDNRAdapter.ts # ENABLED — ArcGIS Online Public_Water_Access_2020
│   │   │   └── virginiaDWRAdapter.ts # Standby
│   │   └── seed/
│   │       └── fourMileRunSites.ts  # 17 seed sites for dev/CI
│   ├── components/
│   │   ├── map/
│   │   │   ├── WaterVoiceMap.tsx   # Full-screen MapLibre map
│   │   │   ├── SiteBottomSheet.tsx # Site detail slide-up panel
│   │   │   ├── FilterBar.tsx       # Horizontally-scrollable type filter
│   │   │   └── SiteMarker.tsx      # Coloured map marker component
│   │   └── ui/
│   │       ├── BottomTabBar.tsx    # Mobile nav: Map / List / Favorites / Account
│   │       ├── FirstUseDisclaimer.tsx  # First-launch safety modal
│   │       ├── InstallPrompt.tsx   # PWA install banner (after 3rd visit)
│   │       └── SplashScreen.tsx    # Loading screen while map initialises
│   ├── types/
│   │   ├── watervoice.types.ts  # WaterStatus, StatusConfig
│   │   └── database.types.ts    # Supabase-generated DB types
│   └── integrations/supabase/
│       ├── client.ts            # Browser Supabase client
│       ├── client.server.ts     # Service-role Supabase client (server only)
│       └── types.ts             # Full Database type definition
├── scripts/                     # One-time seed scripts (run with npx tsx)
│   └── seedMarylandSites.ts     # Seed MD DNR sites from ArcGIS Online
├── cmc_to_sql/
│   ├── cmc-push.mjs             # Residential-IP fetcher → POSTs to ingest-cmc
│   └── cmc-to-sql.mjs           # Legacy: manual SQL-paste helper (retired)
├── supabase/
│   ├── migrations/              # Postgres migration files
│   └── functions/               # Supabase Edge Functions (reference copies)
│       ├── fetch-water-quality/ # Daily WQP bacteria ingestion (E. coli + Enterococci)
│       └── ingest-cmc/          # CMC sample receiver (called by cmc-push.mjs)
├── tests/                       # Integration tests (db/ subdirectory)
├── public/
│   ├── manifest.json            # PWA manifest
│   └── icons/                   # app-icon-192.png, app-icon-512.png
├── .github/workflows/ci.yml     # CI: lint, unit tests, E2E, coverage comment
├── vitest.config.ts
├── package.json
└── .env.example
```

---

## Water Quality Ingestion

Two independent pipelines write bacteria readings into the `readings` table:

```
EPA WQP ──────────────────────────────────────────────────────────────────┐
  (USGS/STORET/NWIS, bbox-tiled, daily CRON 10:00 UTC)                   │
  └─→ fetch-water-quality (Supabase edge fn) ─────────────────────────→  readings
                                                                           │
CMC Data Explorer ─────────────────────────────────────────────────────── │
  cmc2.vims.edu (blocked from datacenters — must run on residential IP)    │
  └─→ cmc-push.mjs (Windows Task Scheduler, daily) ──POST──→ ingest-cmc ─┘
                                                     (edge fn, x-cron-secret auth)
```

See [docs/architecture.md](docs/architecture.md) for the full data flow and [docs/ingestion-cmc.md](docs/ingestion-cmc.md) for the CMC runbook.

---

## Architecture Overview

| Layer | Technology | Version |
|---|---|---|
| Framework | TanStack Start (SSR React) | 1.167.x |
| Router | TanStack Router (file-based) | 1.168.x |
| Build tool | Vite + Cloudflare plugin | 7.x |
| UI library | React | 19.x |
| Styling | Tailwind CSS v4 | 4.2.x |
| Component primitives | Radix UI | various |
| Map | MapLibre GL JS | 5.24.x |
| Map tiles | OpenFreeMap Liberty (no API key) | — |
| Marker clustering | Supercluster | 8.x |
| Data fetching | TanStack Query | 5.83.x |
| Backend / DB | Supabase (Postgres + Auth + Storage) | 2.106.x |
| AI explanations | Anthropic Claude SDK | 0.99.x |
| Email | Resend | server-side |
| Testing (unit) | Vitest + @testing-library/react | 4.x |
| Testing (E2E) | Playwright | 1.60.x |
| Linting | ESLint + typescript-eslint | 9.x |
| Formatting | Prettier | 3.x |
| Git hooks | Husky | 9.x |

---

## Key Concepts

### Water quality statuses

| Status | Meaning |
|---|---|
| PASS | Bacteria below EPA single-sample threshold |
| CAUTION | Bacteria elevated — limit full-body immersion |
| UNSAFE | Bacteria exceed safe contact levels — avoid water |
| NO DATA | No recent reading available |
| STALE (overlay) | Reading is older than 7 days |
| RAIN (overlay) | 1.0 inch or more of rain in 48 hours |

### EPA thresholds used

- **Freshwater E. coli:** PASS <= 235 MPN/100mL; CAUTION 236-410; UNSAFE > 410
- **Tidal/brackish Enterococci:** PASS <= 35 CCE/100mL; CAUTION 36-130; UNSAFE > 130
- Standards basis: EPA 2012 Recreational Water Quality Criteria (RWQC)

### Decision engine

`src/lib/waterQualityEngine.ts` is the single source of truth. It is a pure, side-effect-free TypeScript module. All status classifications, threshold constants, disclaimer strings, and activity advisories live there. See [docs/water-quality-engine.md](docs/water-quality-engine.md).

### SSR and browser guards

The app runs with TanStack Start's SSR mode (server-side rendering). Any code that touches `window`, `localStorage`, `navigator`, or MapLibre must be placed inside `useEffect` or guarded with `typeof window !== 'undefined'`. Failure to do this will cause a hydration error or server crash.

---

## Development Workflow

1. Create a feature branch from `main`.
2. Run `npm run dev` — the Vite dev server includes HMR.
3. Write tests alongside each module (`*.test.ts` or `*.test.tsx`).
4. Run `npm test` to confirm 90%+ coverage thresholds pass.
5. Run `npm run lint` and `npm run type-check`.
6. Commit — Husky pre-commit hook runs lint and format automatically.
7. Open a PR to `main`. CI runs lint, type-check, unit tests, and (on PRs)
   Playwright against the current branch's local server. After review, merge to
   the default branch and publish the synchronized commit through Lovable.

---

## Documentation

- [CLAUDE.md](CLAUDE.md) — **primary context file** for Claude Code sessions; start here
- [docs/architecture.md](docs/architecture.md) — system diagram, data flows, tech stack
- [docs/database.md](docs/database.md) — all tables, RLS policies, functions
- [docs/EDGE_FUNCTIONS.md](docs/EDGE_FUNCTIONS.md) — Supabase Edge Functions reference
- [docs/ROADMAP.md](docs/ROADMAP.md) — pending work items in priority order
- [docs/LOVABLE_WORKFLOW.md](docs/LOVABLE_WORKFLOW.md) — how to work with Lovable safely
- [docs/water-quality-engine.md](docs/water-quality-engine.md) — decision engine API
- [docs/data-ingestion.md](docs/data-ingestion.md) — adapter details and ingestion flow
- [docs/ingestion-cmc.md](docs/ingestion-cmc.md) — CMC residential-fetch runbook
- [docs/api-routes.md](docs/api-routes.md) — REST API endpoint reference
- [docs/components.md](docs/components.md) — major component props
- [docs/auth.md](docs/auth.md) — authentication flow
- [docs/testing.md](docs/testing.md) — test strategy and coverage
- [docs/deployment.md](docs/deployment.md) — deployment and CI
- [docs/seed-data.md](docs/seed-data.md) — the 17 seed sites
- [docs/features.md](docs/features.md) — user-facing feature inventory with status and code locations
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — manual triggers, pg_cron, CMC push, known constraints
- [docs/contributing.md](docs/contributing.md) — contribution guide
- [docs/water-quality-sources.md](docs/water-quality-sources.md) — data sources
- [docs/personas.md](docs/personas.md) — user personas and design council
- [CHANGELOG.md](CHANGELOG.md) — release history
- [KNOWN-ISSUES.md](KNOWN-ISSUES.md) — open bugs and workarounds
