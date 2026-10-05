# Architecture

## System Diagram

```
                        ┌─────────────────────────────────────┐
                        │            Browser / PWA             │
                        │  React 19 + TanStack Router          │
                        │  MapLibre GL + Supercluster          │
                        │  Pages: / /list /rivers /tides       │
                        │         /rivers/:gaugeId /auth/*     │
                        └──────────────┬──────────────────────┘
                                       │ SSR hydration + fetch
                        ┌──────────────▼──────────────────────┐
                        │       TanStack Start Server          │
                        │   (Vite + Cloudflare Worker)         │
                        │                                      │
                        │  GET  /api/sites          (public)   │
                        │  GET  /api/sites/:slug    (public)   │
                        │  GET  /api/sites/:slug/readings      │
                        │  POST /api/explain        (AI SSE)   │
                        │  POST /api/guest-alert    (subscribe)│
                        │  POST /api/public/ingest  (cron)     │
                        └──────┬──────────────┬───────────────┘
                               │              │
              ┌────────────────▼──┐    ┌──────▼──────────────────┐
              │   Supabase         │    │  Anthropic Claude API    │
              │   Postgres + Auth  │    │  (claude-sonnet-4-5)     │
              │   Storage + RLS    │    │  AI explanation stream   │
              └────────┬──────────┘    └─────────────────────────┘
                       │
      ┌────────────────┴─────────────────────────────────┐
      │                                                  │
      │         Data Ingestion (two paths)               │
      │                                                  │
      │  PATH A — TanStack Server (cron via pg_cron)     │
      │  runIngestion() in src/lib/ingest.server.ts      │
      │                                                  │
      │  UsgsWqpAdapter    → USGS Water Quality Portal   │
      │  ArlingtonCounty   → Supabase Storage CSV        │
      │  NoaaRainAdapter   → NWS observation API         │
      │  OsmPoiAdapter     → Overpass API (OSM)          │
      │  OpenDataDCAdapter → DCGIS ArcGIS REST (standby) │
      │  MarylandDNRAdapter→ ArcGIS Online ★ ENABLED     │
      │  VirginiaDWRAdapter→ ArcGIS Online (standby)     │
      │                                                  │
      │  PATH B — Supabase Edge Functions (cron+HTTP)    │
      │                                                  │
      │  fetch-gauge-readings  → USGS IV API             │
      │         └─→ gauge_readings (every 15 min)        │
      │  fetch-tidal-predictions → NOAA CO-OPS API       │
      │         └─→ tidal_predictions (every 6 h)        │
      │  fetch-weather          → NWS API                │
      │         └─→ weather_readings, weather_alerts,    │
      │             rain_events (every 1 h)              │
      │  fetch-water-quality    → EPA WQP (bbox-tiled)   │
      │         └─→ readings (daily 10:00 UTC)           │
      │  fetch-water-conditions → USGS OGC + CBIBS buoys │
      │         └─→ water_temp_observations (every hour) │
      │  ingest-cmc             → receives POST from     │
      │         └─→ readings    cmc-push.mjs (see PATH C)│
      │  send-alerts            → DB trigger (readings)  │
      │         └─→ email via Resend                     │
      │                                                  │
      │  PATH C — Residential fetch for CMC              │
      │                                                  │
      │  CMC Data Explorer (cmc2.vims.edu) blocks cloud  │
      │  datacenter IPs (TCP reset, os error 104).       │
      │  cmc-push.mjs on Windows Task Scheduler (daily)  │
      │         └─→ CMC DashboardApi (residential IP)    │
      │         └─→ POST /functions/v1/ingest-cmc        │
      │               (x-cron-secret auth)               │
      │                 └─→ station matching + EPA       │
      │                     classification + upsert      │
      │                       └─→ readings               │
      └──────────────────────────────────────────────────┘
```

---

## Data Flow: River Stage to Map Marker

```
USGS Instantaneous Values API
  └─→ fetch-gauge-readings (edge fn, every 15 min)
        └─→ INSERT INTO gauge_readings
              (station_id, stage_ft, flow_cfs, trend, recorded_at)
                  └─→ /api/sites calls get_sites_with_latest_reading()
                            └─→ JOIN sites ON nearest_gauge_id = river_gauges.id
                                  └─→ GeoJSON feature with stage_ft, trend
                                            └─→ WaterVoiceMap.tsx
                                                  ├─→ colored vs. grey marker
                                                  └─→ SiteBottomSheet → RiverStage card
```

---

## Data Flow: Tidal Predictions to /tides Page

```
NOAA CO-OPS API
  └─→ fetch-tidal-predictions (edge fn, every 6 h)
        └─→ UPSERT INTO tidal_predictions
              (noaa_station_id, predicted_at, type, height_ft)
                  └─→ /tides page queries tidal_predictions directly
                            └─→ cosine-interpolated 48-h tidal curve chart
                            └─→ next H/L tides list
                            └─→ site navigability badges
```

---

## Site → Station → Reading Relationship

This is the central data model for map coloring. Understanding it is required before modifying any ingestion code.

```
monitoring_stations            site_station_assignments        sites
────────────────────           ───────────────────────        ─────
id ──────────────────────────→ station_id                     id ←── site_id
station_code                   site_id ───────────────────→   name, lat, lng
agency, data_source            distance_m                     water_body_type
lat, lng                       assignment_type                is_tidal
is_tidal
                                                              readings
                                                              ────────
                                                              site_id ──────→ (lights the map pin)
                                                              monitoring_station_id → (attribution)
                                                              e_coli_mpn, enterococci_cce
                                                              status: pass|caution|unsafe
                                                              sampled_at, data_source
```

**How a sample becomes a colored map pin:**

1. `fetch-water-quality` (WQP) or `ingest-cmc` (CMC) receives a bacteria measurement for a `monitoring_station`.
2. It looks up all rows in `site_station_assignments` where `station_id` matches (max 25 km).
3. For each assigned `site_id`, it writes one row to `readings` with both `site_id` and `monitoring_station_id` set.
4. `/api/sites` calls `get_sites_with_latest_reading()`, which JOINs `sites` to the most recent `readings` row.
5. The GeoJSON feature returned to the browser includes `status`, `sampled_at`, and `data_source`.
6. `WaterVoiceMap.tsx` colors the marker green/yellow/red based on `status`; grey if no reading.

**Fan-out:** A single station sample can light up multiple paddle sites if several sites are within the assignment radius. This is expected — a mid-river WQP monitoring station may be within 1500 m of two boat ramps.

**Auto-assignment:** Neither `fetch-water-quality` nor `ingest-cmc` requires pre-seeded `site_station_assignments`. When a station has data but no assignments, both functions create assignments for active sites within `ASSIGN_RADIUS_M` on the fly.

**Personal sites:** User-submitted spots (`sites.status = 'personal'`) use the same machinery. Once a `site_station_assignments` row exists for a personal site + a nearby monitoring station, bacteria readings light up the map pin automatically.

---

## Key RPC Functions

### `get_sites_with_latest_reading(user_lat float8, user_lng float8)`

Returns all active sites joined to their most recent `readings` row (bacteria) and most recent `gauge_readings` row (stage/flow) via `nearest_gauge_id`. Also returns equirectangular `distance_km`.

Used by `GET /api/sites`. Called from the browser without a user location when no coordinates are available.

### `get_site_readings_history(p_site_id uuid, days_back int DEFAULT 90)`

Returns all bacteria readings for a site within the past N days, ordered by `sampled_at DESC`. Used by `GET /api/sites/:slug/readings`.

---

## Component Hierarchy

```
__root.tsx
  └─ BottomTabBar
  └─ <Outlet>
       ├─ index.tsx (map)
       │    ├─ WaterVoiceMap
       │    │    ├─ SiteMarker (per cluster member)
       │    │    └─ SiteBottomSheet
       │    │         ├─ WaterQualityBadge
       │    │         ├─ RiverStage (when nearest_gauge_id present)
       │    │         ├─ WeatherCard (NWS forecast)
       │    │         └─ AskWaterVoiceAI (streams /api/explain)
       │    └─ FilterBar
       ├─ list.tsx
       │    └─ SiteCard (per site)
       ├─ rivers.index.tsx
       │    └─ GaugeCard (per non-tidal gauge)
       ├─ rivers.$gaugeId.tsx
       │    ├─ StageChart (7-day recharts line chart)
       │    ├─ ReadingsTable
       │    └─ LinkedSitesList
       ├─ tides.tsx
       │    ├─ TidalCurveChart (cosine-interpolated recharts area chart)
       │    ├─ NextTidesList
       │    └─ SiteNavigabilityList
       ├─ favorites.tsx (auth-gated)
       ├─ alerts.tsx (auth-gated)
       ├─ account.tsx (auth-gated)
       └─ auth/**
```

---

## Hosting and Infrastructure

The app is developed and hosted in **Lovable Cloud** at
`dc-water-watch.lovable.app`. Lovable publishes the TanStack Start application
as a Cloudflare Worker plus static assets. The connected GitHub repository uses
two-way sync, with the default branch as the reviewed release boundary. The
backend is **Supabase** (managed Postgres on AWS us-east-1).

**Data ingestion triggers:**

- `pg_cron` in Supabase calls `pg_net.http_post` against `/api/public/ingest` (PATH A)
- Supabase cron triggers call Edge Function HTTP endpoints (PATH B)
- `cmc-push.mjs` on Windows Task Scheduler calls `ingest-cmc` directly (PATH C)
- PATH A + B cron jobs authenticate with `Authorization: Bearer <service-role-key>`; `ingest-cmc` and manual triggers use `x-cron-secret: <CRON_SECRET>`

**CMC residential-IP constraint:**
CMC's server (`cmc2.vims.edu`, Microsoft-IIS) resets TCP connections from cloud datacenter IP ranges (AWS, GCP, Supabase). The same block applies to Lambda and EC2. The residential fetch in PATH C must remain until VIMS allowlists an egress IP or provides an official API. The `ingest-cmc` handler itself is portable to Lambda + API Gateway — only the outer wrapper changes.

**Infrastructure ownership:**
Supabase is provisioned and owned by Lovable. Safe database migrations are
versioned in `supabase/migrations/` and applied by Lovable Test/Live publishing;
Supabase Edge Function changes still go through Lovable. Application code and
versioned static assets merged to the connected default branch sync back to
Lovable and are promoted together when an operator publishes. Future migration
target: AWS.

**Map tiles:** OpenFreeMap Liberty (free, no API key required)

**Email:** Resend (via `send-alerts` edge function and `guest-alert` API route)

---

## Full Tech Stack

| Layer | Package | Version |
|---|---|---|
| SSR framework | `@tanstack/react-start` | 1.167.50 |
| File router | `@tanstack/react-router` | 1.168.25 |
| Vite plugin (router) | `@tanstack/router-plugin` | 1.167.28 |
| Build | `vite` | 7.3.1 |
| Cloudflare adapter | `@cloudflare/vite-plugin` | 1.25.5 |
| Lovable config | `@lovable.dev/vite-tanstack-config` | 1.7.0 |
| React | `react` + `react-dom` | 19.2.0 |
| Data fetching | `@tanstack/react-query` | 5.83.0 |
| Styling | `tailwindcss` v4 | 4.2.1 |
| Tailwind Vite plugin | `@tailwindcss/vite` | 4.2.1 |
| Component library | `@radix-ui/*` | various |
| Class merge | `clsx` + `tailwind-merge` | 2.x / 3.x |
| CVA | `class-variance-authority` | 0.7.1 |
| Map | `maplibre-gl` | 5.24.0 |
| Clustering | `supercluster` | 8.0.1 |
| Charting | `recharts` | 2.15.4 |
| Forms | `react-hook-form` + `@hookform/resolvers` | 7.x / 5.x |
| Validation | `zod` | 3.24.2 |
| Toast | `sonner` | 2.0.7 |
| Date utils | `date-fns` | 4.1.0 |
| Icons | `lucide-react` | 0.575.0 |
| Drawer | `vaul` | 1.1.2 |
| AI SDK | `@anthropic-ai/sdk` | 0.99.0 |
| Supabase JS | `@supabase/supabase-js` | 2.106.2 |
| Unit tests | `vitest` | 4.1.7 |
| Coverage | `@vitest/coverage-v8` | 4.1.7 |
| Testing Library | `@testing-library/react` | 16.3.2 |
| DOM env | `jsdom` | 29.1.1 |
| E2E tests | `@playwright/test` | 1.60.0 |
| TypeScript | `typescript` | 5.8.3 |
| ESLint | `eslint` + `typescript-eslint` | 9.x |
| Prettier | `prettier` | 3.7.3 |
| Git hooks | `husky` | 9.1.7 |

---

## SSR and Browser Guards

TanStack Start renders pages on the server before hydrating them in the browser. Any access to browser globals (`window`, `document`, `localStorage`, `navigator`, `matchMedia`) will throw during SSR.

```typescript
// Option 1 — delay until after mount
useEffect(() => {
  setIsMounted(true);
}, []);
if (!isMounted) return <Skeleton />;

// Option 2 — guard inline
if (typeof window !== 'undefined') {
  localStorage.setItem(key, value);
}
```

MapLibre GL is imported dynamically inside `useEffect` because it accesses `window` at module evaluation time. The `*.server.ts` naming convention prevents Vite from bundling server-only files (like `client.server.ts` which holds the service role key) into the client bundle.
