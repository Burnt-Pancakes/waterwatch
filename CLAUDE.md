# WaterWatch — Claude Code Context

This is the primary context file for all Claude Code sessions on this project. Read this before touching any file. Keep it up to date when the state of the app changes.

---

## What This App Is

**WaterWatch** is a civic water quality advisory app for the DC Metro area. It answers one question for paddlers, kayakers, swimmers, and families: **"Is it safe to get in the water today?"**

Live app: **https://dc-water-watch.lovable.app**

GitHub: **https://github.com/rajivsundar/dc-water-watch**

---

## Critical Workflow Rules

> These rules are non-negotiable. Read them before every session.

### 1. Always `git pull origin main` before starting work

Lovable makes commits directly to `main`. Your local branch will be stale after any Lovable session. Always pull first.

### 2. `main` is the two-way Lovable sync boundary

Lovable commits changes to GitHub, and reviewed commits merged to the connected
default branch sync back into Lovable. A feature branch is not live until it is
merged and published through Lovable.

### 3. Avoid manual production release dependencies

Express database structure and function changes as idempotent files under
`supabase/migrations/`. Prefer same-origin TanStack server routes for new
backend features when that keeps code and data deployment atomic. Existing
Supabase Edge Functions still run in the managed Lovable project, but a new
release must not require an operator to upload artifacts or copy dashboard
secrets by hand.

### 4. Complex Lovable features cost 3–5 credits — split them

A single Lovable prompt that touches layout, data fetching, and a new component will cost 3–5 credits and often leaves layout breakage. Split complex features into separate prompts:
- Prompt 1: schema / data layer
- Prompt 2: component logic
- Prompt 3: layout polish

### 5. Layout polish is always needed after feature additions

New Lovable features repeatedly cause elements to hide behind the bottom tab bar or overlap each other. Always plan a layout polish prompt after every feature addition.

### 6. Never `git reset --hard` unless intentionally discarding local work

If you need to undo local changes that conflict with remote, confirm with the user first. This destroyed work once before.

---

## Current Database State

> Last verified: June 2026. All numbers are from runtime state, not migrations.

- **783 total sites**: 531 MD (`mddnr`), 246 VA (`vadwr`), 6 DC
- **All 783 sites** have `nearest_gauge_id` assigned
- **188 gauges** in `river_gauges`:
  - 171 USGS streamflow gauges (161 with active readings in `gauge_readings`)
  - 18 NOAA tidal stations (flagged `is_tidal = true`, have `noaa_station_id`)
- **284 `tidal_brackish` sites** with `tidal_gauge_station_id` assigned
- **255 sites** with `is_tidal = TRUE` (tidal_brackish AND `lng > -77.3`)
- **136 tidal predictions** loaded across all 18 NOAA stations in `tidal_predictions`
- **35 migration files** in `supabase/migrations/`

---

## Live Features (fully working)

| Feature | Route | Notes |
|---|---|---|
| Map with 783 sites | `/` | Colored (data) vs grey (no data) markers |
| Site bottom sheet | `/` (tap marker) | River stage card, weather card, activity advisory |
| Site detail | `/sites/:slug` | Full readings history, chart, rain advisory |
| List view | `/list` | All active sites |
| Rivers index | `/rivers` | All 171 non-tidal USGS gauges |
| River detail | `/rivers/:gaugeId` | Stage, flow, 7-day chart, linked sites |
| Tides & trip planning | `/tides` | Tidal curve chart, next tides, site navigability |
| Auth | `/auth/*` | Email/password + magic link |
| Favorites | `/favorites` | Auth-gated |
| Alerts | `/alerts` | Auth-gated, email + guest |
| Account | `/account` | Auth-gated |
| AI explanation | bottom sheet | Streams from `/api/explain`; requires `ANTHROPIC_API_KEY` |

---

## Edge Functions (Lovable Supabase only)

These run on Supabase Deno runtime. They are **not deployed from GitHub**. Reference copies are in `supabase/functions/` but the canonical versions live in Lovable's Supabase dashboard.

`ingest-cmc` is a receiver-only edge function — it has no cron of its own. The residential push client (`cmc_to_sql/cmc-push.mjs`) runs on the local machine via Task Scheduler and POSTs samples to it (CMC's server blocks datacenter IPs).

| Function | Trigger | Source API | Target Table | Schedule |
|---|---|---|---|---|
| `fetch-gauge-readings` | HTTP POST / cron | USGS Instantaneous Values API | `gauge_readings` | Every 15 min |
| `fetch-tidal-predictions` | HTTP POST / cron | NOAA CO-OPS API (station 8594900) | `tidal_predictions` | Every 6 h |
| `fetch-water-quality` | pg_cron | USGS WQP / VA DEQ | `readings` | Daily 10:00 UTC (registered 2026-07-04) |
| `fetch-water-conditions` | pg_cron | USGS OGC API + CBIBS buoys | `water_temp_observations`, `ingest_runs` | Hourly at :05 |
| `fetch-weather` | HTTP POST / cron | NWS API (central DC) | `weather_readings`, `weather_alerts`, `rain_events` | Every 1 h |
| `send-alerts` | DB trigger on `readings` INSERT | — | Email via Resend | On insert |
| `ingest-cmc` | HTTP POST from `cmc-push.mjs` | CMC Data Explorer | `readings` | Daily via local Task Scheduler |

`fetch-gauge-readings` skips gauges where `usgs_site_number` starts with `NOAA-`.

---

## Key Files

| File | Purpose |
|---|---|
| `src/lib/waterQualityEngine.ts` | **SAFETY-CRITICAL** EPA decision engine — pure TS, no side effects |
| `src/lib/ingest.server.ts` | Ingestion orchestrator (7 adapters) |
| `src/lib/adapters/marylandDNRAdapter.ts` | MD DNR ArcGIS Online adapter — **ENABLED** (fixed June 2026) |
| `src/components/map/WaterVoiceMap.tsx` | Full-screen MapLibre map |
| `src/components/map/SiteBottomSheet.tsx` | Site detail slide-up panel |
| `src/components/site/RiverStage.tsx` | USGS gauge card in bottom sheet |
| `src/routes/tides.tsx` | Tides & trip planning page |
| `src/routes/api/route-v2.ts` | Scenic, fail-closed same-origin kayak routing endpoint |
| `src/lib/routingAssetFetch.server.ts` | Cloudflare ASSETS loader for bundled graph shards |
| `src/lib/scenicRouteApi.server.ts` | Corridor shard loading and route service |
| `scripts/build-scenic-routing-graph.ts` | OSM topology/open-water graph compiler |
| `src/routes/rivers.$gaugeId.tsx` | River detail page |
| `src/integrations/supabase/types.ts` | **Authoritative** DB type definitions (generated by Lovable) |

---

## Adapter Status

| Adapter | Source | Status |
|---|---|---|
| `UsgsWqpAdapter` | USGS Water Quality Portal | ✅ Active |
| `ArlingtonCountyAdapter` | Supabase Storage CSV | ✅ Active |
| `NoaaRainAdapter` | NWS Observations API | ✅ Active |
| `OsmPoiAdapter` | OpenStreetMap Overpass API | ✅ Active |
| `MarylandDNRAdapter` | ArcGIS Online Public_Water_Access_2020 | ✅ **ENABLED** (June 2026) |
| `VirginiaDWRAdapter` | ArcGIS Online DWR_Boating_Access | ⚠️ Standby (endpoint unverified) |
| `OpenDataDCAdapter` | DCGIS ArcGIS REST | ⚠️ Standby (endpoint unverified) |

---

## Pending Work (Roadmap)

See `docs/ROADMAP.md` for the full prioritized list. Summary:

1. Layout polish (elements overlapping bottom tab bar after recent features)
2. `ANTHROPIC_API_KEY` in Lovable Secrets (activates "Ask WaterWatch AI" button)
3. Water quality data sources (EPA WQP / DOEE stations)
4. `/rivers` page enrichment (show reading counts, filter by state)
5. Columbia Island Marina manual INSERT
6. Nearby gauge override UI
7. Tidal chart site-specific min_navigable_ft lines (currently hardcoded Potomac/Anacostia)

---

## Development Setup

```bash
git clone https://github.com/rajivsundar/dc-water-watch.git
cd dc-water-watch
npm install
cp .env.example .env
# Fill in VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY
npm run dev
```

### Scripts

```
npm run dev          # TanStack Start dev server (localhost:8080)
npm test             # Vitest unit tests + coverage (90% thresholds)
npm run test:watch   # Vitest watch mode
npm run test:e2e     # Playwright E2E
npm run lint         # ESLint
npm run type-check   # tsc --noEmit
npm run format       # Prettier
```

One-time seed scripts:
```bash
npx tsx scripts/seedMarylandSites.ts   # Seed MD DNR sites from ArcGIS
```

---

## Code Standards

1. Map is fully public — no auth to view water quality.
2. Auth gates only favorites, alerts, account management.
3. All browser-only code must be in `useEffect` or guarded by `typeof window !== 'undefined'`.
4. RLS on every table — never bypass from client code.
5. 90% Vitest coverage on `src/lib/**/*.ts`.
6. Mobile-first, verified at 390px width.
7. Dark mode via Tailwind `dark:` prefix.
8. `waterQualityEngine.ts` is SAFETY-CRITICAL: pure, no side effects, no threshold changes without citing the regulation.
9. Every surface that displays water quality data must show a disclaimer from `DISCLAIMERS` in `waterQualityEngine.ts`.
10. `supabase as unknown as SupabaseClient` pattern for querying tables not in generated types (never `supabase as any`).

---

## Known Contradictions (pre-existing in docs)

The following `docs/` files contain stale information as of June 2026:

- `docs/data-ingestion.md` — still says `MarylandDNRAdapter` is DISABLED and references the old dead `geodata.md.gov` URL. **Correct state: ENABLED**, pointing to ArcGIS Online `Public_Water_Access_2020`.
- `docs/water-quality-sources.md` — same stale status for Maryland DNR.
- `docs/database.md` — missing tables: `river_gauges`, `gauge_readings`, `stage_thresholds`, `tidal_predictions`. Missing columns on `sites`. See `docs/DATABASE.md` for the updated schema.
- `docs/architecture.md` — missing Edge Functions data pipeline. See `docs/ARCHITECTURE.md`.
- `README.md` directory guide lists 11 migrations; there are now 23.

The generated types at `src/integrations/supabase/types.ts` are always the authoritative source of truth for the DB schema.
