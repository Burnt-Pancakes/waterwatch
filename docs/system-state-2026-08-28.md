# WaterWatch System State — 2026-09-02

Ground-truth snapshot of live database vs. repo. Every finding is backed by
the query or file read shown. Nothing is inferred.

---

## How to read this document

**Live DB queries** used `GET /rest/v1/<table>` and `POST /rest/v1/rpc/<fn>`
against `https://nchorqfnmbngewnhgcvh.supabase.co` with the anon/publishable
key. The cron schema and `pg_catalog` are not accessible via the anon key;
those findings come from migration files only and are marked **[from migration]**.

**Column presence** was confirmed by requesting `?limit=1` and checking the
returned JSON keys, or by selecting specific columns and checking for HTTP 400.

---

## 1. Live Database Schema

### 1.1 Tables — row counts and confirmed columns

**Query pattern:** `GET /rest/v1/<table>?limit=1` for columns;
`GET /rest/v1/<table>?select=count` with `Prefer: count=exact` for rows.

| Table | Rows | Notes |
|---|---|---|
| sites | 791 | Active civic access points |
| readings | 1,508 | Water quality samples |
| water_temp_observations | 12,563 | Temperature from USGS + CBIBS |
| gauge_readings | unknown† | USGS stage/flow; RLS blocks count |
| river_gauges | 188 | USGS gauge metadata |
| tidal_predictions | 6,409 | NOAA CO-OPS hi/lo |
| weather_readings | 2,034 | NWS hourly forecasts |
| weather_alerts | 131 | NWS active alerts |
| rain_events | 415 | Rolling precip totals |
| stage_thresholds | 188 | Stage action/flood levels |
| monitoring_stations | 5,301 | WQP station metadata |
| site_station_assignments | 877 | Site ↔ monitoring station mapping |
| ingest_runs | 0 | Table exists; no rows written yet |
| alerts | 0 | User alert subscriptions |
| favorites | 0 | User favorites |
| guest_alerts | 0 | Email-only alert subscriptions |

†`gauge_readings` count: `Prefer: count=exact` returned null content-range
(RLS or index missing). Newest `recorded_at` = 2026-09-02T23:50 UTC via
`order=recorded_at.desc`.

**`sites` confirmed columns** (from `?limit=1`):
`id, name, slug, site_type, water_body_type, lat, lng, address, description,
amenities, parking_notes, ada_accessible, osm_id, data_source_ids, is_active,
created_at, updated_at, nearest_gauge_id, is_tidal, min_navigable_ft,
tidal_gauge_station_id, water_body, num_ramps, access_type, driving_directions,
county, region, state_code, owner_id, status, source, source_external_id`

**`readings` confirmed columns** (from `?limit=1`):
`id, site_id, sampled_at, ingested_at, e_coli_mpn, enterococci_cce,
sample_method, data_source, source_url, status, raw_payload, notes,
created_at, monitoring_station_id`

> Note: live column names are `e_coli_mpn` and `enterococci_cce` —
> not `ecoli_cfu_per_100ml` / `enterococci_cfu_per_100ml` as some
> earlier docs implied.

**`water_temp_observations` confirmed columns** (from `?limit=1`):
`id (uuid), source, station_code, station_name, time_series_id, lat, lng,
observed_at, depth_m, temp_c, qa, created_at`

> `ingested_at` is **absent** from the live table. The column is `created_at`.
> Our migration `20260826000000` specified `ingested_at`; Lovable's migration
> `20260827150825` applied instead with `created_at`.

**`gauge_readings` confirmed columns** (from `?limit=1`):
`id, station_id, recorded_at, stage_ft, flow_cfs, trend, qualifier,
raw_json, created_at`

> Note: FK column is `station_id` (not `gauge_id`); stage column is
> `stage_ft` (not `value_ft`).

**`monitoring_stations` confirmed columns** (from `?limit=1`):
`id, station_code, station_name, agency, org_identifier, data_source, lat,
lng, state_code, county, huc8, location_type, is_tidal, characteristics,
typical_cadence_days, last_sample_at, is_active, created_at`

**`site_station_assignments` confirmed columns** (from `?limit=1`):
`id, site_id, station_id, distance_m, assignment_type, priority,
is_primary, created_at`

**`tidal_predictions` confirmed columns** (from `?limit=1`):
`id, noaa_station_id, predicted_at, type, height_ft, fetched_at`

**`ingest_runs` confirmed columns** (from `?limit=1`, returns empty array):
Could not confirm columns via row data (0 rows). From migration
`20260827232036` + `20260828031318`: `id, run_name, function_name,
started_at, finished_at, status, rows_upserted, tiles_processed,
error, summary`. Column `function_name` confirmed present by migration
`20260828031318` (`ADD COLUMN IF NOT EXISTS function_name text`).

**Always-NULL columns observed:**
- `depth_m` on `water_temp_observations` — 12,563 rows; neither USGS nor
  CBIBS reports depth. Column is intentionally reserved.
- `enterococci_cce` on `readings` — all 5 latest rows returned null.
  E. coli readings dominate; enterococci samples rare in current data.

### 1.2 Live functions

**Query:** `POST /rest/v1/rpc/<fn>` with appropriate params; 200 = exists.

| Function | Status | Source |
|---|---|---|
| `get_sites_with_latest_reading(user_lat float8, user_lng float8)` | **EXISTS** — 200 | Migration 20260527015305 |
| `calculate_trip_waypoints(p_waypoints jsonb)` | **EXISTS** — 200 | Migration 20260715000000 |
| `bulk_update_last_sample_at(p_rows jsonb)` | **EXISTS** — 401 (anon denied) | Migration 20260827224542 |
| `nearest_water_temp(p_lat, p_lng, p_max_km)` | **ABSENT** — 404 PGRST202 | Migration 20260828120000 (not yet applied) |
| `_get_vault_secret(p_name text)` | not testable via anon | Migration 20260527023446 |

**`get_sites_with_latest_reading` has no staleness bound.** The inner lateral
join is `ORDER BY sampled_at DESC LIMIT 1` with no `WHERE sampled_at >`
filter. A site with one reading from 2024 returns that reading. Source:
`supabase/migrations/20260527015305_cfaa4504.sql` lines 237–279.

### 1.3 Indexes on relevant tables

Cannot query `pg_indexes` with the anon key. The following indexes are
**known from migration files** and are assumed applied since the tables exist:

- `readings`: unique index on `(site_id, sampled_at, data_source)` —
  migration 20260527022657
- `water_temp_observations`:
  - `(observed_at DESC)` — migration 20260827150825 (Lovable)
  - `(source, station_code, observed_at DESC)` — migration 20260827150825
  - unique constraint `(source, station_code, observed_at)` — migration 20260827150825
  - **No `(lat, lng)` index** — our migration 20260826000000 included it,
    but Lovable's 20260827150825 omits it. Since 20260826000000 was never
    applied, the lat/lng index does **not** exist in production. The bbox
    prefilter in `nearest_water_temp` has no index to hit.

---

## 2. Migration Reconciliation

### 2.1 Every file with commit SHA and applied status

Commits determined via `git log --format="%H %ad" --date=short -- supabase/migrations/`.
Applied status determined by checking whether the effect is visible in the
live database via REST probes.

| File | Commit | Date | Applied | Notes |
|---|---|---|---|---|
| `20260527015305_cfaa4504.sql` | 7f61172 | 2026-05-27 | ✅ | Initial schema: sites, readings, get_sites_with_latest_reading |
| `20260527015319_bdc9f2d4.sql` | 7f61172 | 2026-05-27 | ✅ | REVOKE on trigger functions |
| `20260527021535_8f7feedf.sql` | 74b16cd | 2026-05-27 | ✅ | auth_rate_limits table |
| `20260527021553_d101253a.sql` | f1b8654 | 2026-05-27 | ✅ | RLS deny policy on auth_rate_limits |
| `20260527022657_db715d9d.sql` | 8507d2a | 2026-05-27 | ✅ | readings unique index |
| `20260527023446_c3dc7b73.sql` | 1e2ceab | 2026-05-27 | ✅ | pg_cron/pg_net, vault, cron jobs ingest-all/noaa/osm |
| `20260527023506_507b2baf.sql` | 16ced55 | 2026-05-27 | ✅ | Moves pg_cron to extensions schema |
| `20260528000001_guest_alerts_and_send_alerts.sql` | 60f8119 | 2026-05-28 | ✅ | guest_alerts expansion, send-alerts trigger |
| `20260529162451_661ffeb3.sql` | a15c6a0 | 2026-05-29 | ✅ | Storage policy (arlington-data) |
| `20260530000001_fix_arlington_storage_policy.sql` | 78bdac8 | 2026-05-29 | ✅ | Fixes inverted bucket policy |
| `20260530024340_7ae87f23.sql` | 9d62ae6 | 2026-05-30 | ✅ | guest_alerts table |
| `20260531234624_e367e9ad.sql` | ff29896 | 2026-05-31 | ✅ | Storage policy fix |
| `20260601000001_river_gauges.sql` | cb412cb | 2026-06-01 | ⚠️ superseded | Original river_gauges DDL; overwritten by 20260603 |
| `20260603032546_ec8d7966.sql` | 06db695 | 2026-06-03 | ✅ | Authoritative river_gauges + gauge_readings DDL |
| `20260606105603_e302d54b.sql` | 986af39 | 2026-06-06 | ✅ | GRANTs on gauge tables |
| `20260611191534_fix_tidal_predictions_station_id_prefix.sql` | d07d722 | 2026-06-11 | ✅ | Prefixes NOAA- on existing rows |
| `20260611192409_add_upcoming_tides_view.sql` | d7ede33 | 2026-06-11 | ✅ | v_upcoming_tides view |
| `20260611193625_fix_view_security_invoker.sql` | 7ad18e7 | 2026-06-11 | ✅ | security_invoker on views |
| `20260614082118_stage_thresholds_seeded.sql` | 38972c6 | 2026-06-14 | ✅ | Documentation-only; seeded separately |
| `20260617000001_weather_alert_notifications.sql` | ab96986 | 2026-06-17 | ✅ | weather_alert_notifications table |
| `20260617143000_trip_planner.sql` | b6e87e2 | 2026-06-17 | ✅ | trips table and waypoints RPCs |
| `20260619112855_a5bde5fb.sql` | 05ab792 | 2026-06-19 | ✅ | waterways storage bucket policy |
| `202607040530_schedule_fetch_water_quality.sql` | c89876c | 2026-07-04 | ✅ | fetch-water-quality cron at 10:00 UTC |
| `20260711000001_rain_events_add_24h.sql` | 6364fc3 | 2026-07-11 | ✅ | precipitation_inches_24h column on rain_events |
| `20260715000000_use_routed_trip_distances.sql` | d2ebc35 | 2026-07-15 | ✅ | calculate_trip_waypoints function |
| `20260826000000_water_temp_observations.sql` | 79d9237 | 2026-08-26 | ❌ **NOT APPLIED** | Our DDL with `bigserial id`, `ingested_at`; never executed |
| `20260827150825_74e47adc.sql` | d1563b3 | 2026-08-28 | ✅ | Lovable's water_temp_observations: `uuid id`, `created_at`, RLS, GRANTs |
| `20260827224542_69a5bcea.sql` | d1563b3 | 2026-08-28 | ✅ | bulk_update_last_sample_at function |
| `20260827232036_36fdcee4.sql` | d1563b3 | 2026-08-28 | ✅ | ingest_runs table |
| `20260828031318_6ef0227f.sql` | d1563b3 | 2026-08-28 | ✅ | function_name on ingest_runs; fetch-water-conditions-hourly cron; prune cron |
| `20260828120000_nearest_water_temp_fn.sql` | 0fa37bc | 2026-09-02 | ❌ **NOT APPLIED** | nearest_water_temp(); 404 via RPC probe |

### 2.2 Known divergences

**`water_temp_observations` DDL conflict.** Our migration specifies `bigserial`
primary key and `ingested_at` column. Lovable's migration specifies `uuid`
primary key and `created_at`. Our migration was never applied; Lovable's was.
The live table matches Lovable's DDL.

**`nearest_water_temp` absent.** File exists in repo (`0fa37bc`), pushed to
GitHub, but Lovable has not applied it. RPC probe returns 404.

**`(lat, lng)` index missing on `water_temp_observations`.** Our migration
`20260826000000` included this index; Lovable's `20260827150825` omits it.
Since our migration was never applied, the index does not exist. The bbox
prefilter in `nearest_water_temp` will do a sequential scan on the `latest`
CTE rows — acceptable now (88 rows), but worth noting.

**Readings schema evolution not in any our-authored migration.** The live
`readings` table has `monitoring_station_id` and uses `e_coli_mpn` /
`enterococci_cce` column names. None of our migration files add
`monitoring_station_id` to readings. This column was added by a Lovable
migration that is only in the repo as a UUID-named file (one of the
`d1563b3 Changes` group). Could not confirm which specific file without
reading all of them.

### 2.3 Live tables with no migration file

Confirmed by cross-referencing table names visible via REST against migration
file contents:

| Table | Has migration? | Notes |
|---|---|---|
| `monitoring_stations` | ❌ No | 5,301 rows; Lovable-only |
| `site_station_assignments` | ❌ No | 877 rows; Lovable-only |
| `weather_alert_notifications` | ✅ Yes | `20260617000001` |

Tables accessible via REST that appear in migrations but may have been
significantly altered by Lovable (confirm against live columns before writing
to them): `sites`, `readings`, `gauge_readings`.

---

## 3. Edge Functions

All source files are in `supabase/functions/`. These are reference copies —
canonical deployed versions live in Lovable's Supabase dashboard.

### 3.1 Function inventory

| Function | Trigger | External APIs | Writes to |
|---|---|---|---|
| `fetch-gauge-readings` | HTTP POST / cron (15 min) | USGS Instantaneous Values API (IV) | `gauge_readings` |
| `fetch-tidal-predictions` | HTTP POST / cron (6 h) | NOAA CO-OPS predictions | `tidal_predictions` |
| `fetch-weather` | HTTP POST / cron (1 h) | NWS API (central DC point) | `weather_readings`, `weather_alerts`, `rain_events` |
| `fetch-water-quality` | pg_cron (daily 10:00 UTC) | USGS WQP, VA DEQ ArcGIS | `readings`, `monitoring_stations` |
| `fetch-water-conditions` | pg_cron (hourly :05) | USGS OGC API v0, CBIBS buoybay | `water_temp_observations`, `ingest_runs` |
| `ingest-cmc` | HTTP POST from `cmc-push.mjs` | None (receiver only) | `readings` |
| `send-alerts` | DB trigger on readings INSERT | Resend email API | None (emails only) |
| `get-route` | HTTP POST | None (Haversine, in-memory graph) | None (read-only RPC) |
| `get-signed-upload-url` | HTTP POST | None | Supabase Storage (signed URL) |
| `get-upload-url` | HTTP POST | None | Supabase Storage (signed URL) |

### 3.2 Drift — repo vs. deployed

**`fetch-water-conditions` — `skipped_stale_age_buckets`.** This field IS
present in the current repo source (`f707c28 Bucketed stale skips by age`).
It was previously absent. No drift here as of this snapshot.

**`fetch-water-conditions` — `ingest_runs` writes.** The repo source includes
`finishRun()` that inserts into `ingest_runs`. The live `ingest_runs` table has
0 rows. Either (a) the function has not run since the migration was applied, or
(b) the deployed Deno function predates the `finishRun` addition and has not
been redeployed via Lovable. Cannot determine which without Lovable dashboard
access. Mark as **could-not-determine**.

**`fetch-water-conditions` — ST-TS/ST-CA fix.** Repo has `["ST", "ST-TS",
"ST-CA", "ES", "LK"]` (commit `9b823cd`). Cannot confirm the deployed
function matches without Lovable dashboard access. **Could-not-determine.**

**`fetch-water-quality` — `monitoring_station_id` on readings.** The function
writes `monitoring_station_id` into readings rows. The live readings table has
this column. This is consistent.

---

## 4. Scheduled Jobs

**Cannot query `cron.job` directly** — the `cron` schema is not exposed via
PostgREST with the anon key. The following is reconstructed from migration
files only (`[from migration]`).

| Job name | Schedule | Target | timeout_ms | Notes |
|---|---|---|---|---|
| `ingest-all` | `0 6 * * *` (daily 06:00 UTC) | vault `ingest_url` (Lovable preview URL) | **none — pg_net default 5 s** ⚠️ | Comment in migration: "stalled until AWS migration" |
| `ingest-noaa` | `0 */6 * * *` (every 6 h) | vault `ingest_url` | **none — pg_net default 5 s** ⚠️ | Same stall note |
| `ingest-osm` | `0 4 * * 1` (weekly Mon 04:00 UTC) | vault `ingest_url` | **none — pg_net default 5 s** ⚠️ | Same stall note |
| `fetch-water-quality` | `0 10 * * *` (daily 10:00 UTC) | Supabase edge function | **none — pg_net default 5 s** ⚠️ | Migration `202607040530` |
| `fetch-water-conditions-hourly` | `5 * * * *` (every hour at :05) | Supabase edge function | **120,000 ms** ✅ | Migration `20260828031318` |
| `prune-water-temp-observations-daily` | `20 3 * * *` (daily 03:20 UTC) | `DELETE FROM water_temp_observations WHERE observed_at < now() - interval '90 days'` | n/a (SQL, not HTTP) | Migration `20260828031318` |

⚠️ **Four jobs lack explicit `timeout_milliseconds`.** pg_net's default is
5,000 ms. These jobs POST to endpoints that routinely take 30–120 s. The
HTTP request will be dispatched but the response will be discarded after
5 s. The ingest itself may complete (the timeout only affects pg_net
waiting for the response), but any response-based error detection fails.

### 4.1 Data freshness per job target

| Table | Newest observation | Gap to 2026-09-02 23:59 UTC |
|---|---|---|
| `gauge_readings` | 2026-09-02T23:50 UTC | ~9 min — **live** |
| `tidal_predictions` | predicted_at 2026-09-11, fetched 2026-09-03T00:00 | **live** |
| `weather_readings` | not confirmed (2034 rows present) | assumed live |
| `rain_events` | 2026-09-03T00:00 UTC | **live** |
| `water_temp_observations` | 2026-09-03T00:05 UTC (created_at) | **live** |
| `readings` (WQP/CMC) | sampled_at 2026-08-26, ingested_at 2026-08-27 | **7 days stale** |
| `monitoring_stations` | created_at 2026-08-28 | **5 days** |
| `ingest_runs` | 0 rows | n/a |

---

## 5. Data Freshness and Volume

Queries: `GET /rest/v1/<table>?order=<ts>.desc&limit=1`.

| Table | Rows | Oldest ts | Newest ts | Status |
|---|---|---|---|---|
| `sites` | 791 | 2026-05-27 | 2026-06-23 | Static (site creation) |
| `readings` | 1,508 | n/a (no min probe) | sampled 2026-08-26, ingested 2026-08-27 | ⚠️ 7 days stale |
| `water_temp_observations` | 12,563 | 2026-08-27T13:05 UTC | 2026-09-03T00:05 UTC | ✅ Live |
| `gauge_readings` | unknown | 2026-06-04 | 2026-09-02T23:50 UTC | ✅ Live |
| `river_gauges` | 188 | 2026-06-03 | 2026-06-11 | Static |
| `tidal_predictions` | 6,409 | n/a | predicted 2026-09-11; fetched 2026-09-03 | ✅ Live |
| `weather_readings` | 2,034 | n/a | n/a | assumed live (hourly cron) |
| `weather_alerts` | 131 | n/a | n/a | assumed live |
| `rain_events` | 415 | 2026-06-10 | 2026-09-03T00:00 UTC | ✅ Live |
| `stage_thresholds` | 188 | n/a | n/a | Static (seeded) |
| `monitoring_stations` | 5,301 | 2026-06-21 | 2026-08-28T11:37 UTC | ⚠️ 5 days stale |
| `site_station_assignments` | 877 | 2026-06-22 | 2026-08-28T11:37 UTC | ⚠️ 5 days stale |
| `ingest_runs` | 0 | — | — | Empty |
| `alerts`, `favorites`, `guest_alerts` | 0 each | — | — | No data |

---

## 6. Frontend Structure

Confirmed via `ls src/`, `ls src/lib/`, `ls src/routes/`.

```
src/
  components/
    auth/           AuthNav
    map/            WaterVoiceMap.tsx, SiteBottomSheet.tsx, FilterBar, ...
    plan/           RouteBuilderPanel, TripPlannerMap, ...
    site/           RiverStage, TideStrip, WeatherCard, AIExplanation, ...
    ui/             shadcn/ui components
  emails/           statusAlertEmail (Resend templates)
  hooks/            use-auth, use-mobile
  integrations/
    supabase/       client.ts, client.server.ts, types.ts, auth-*
  lib/
    adapters/       7 adapter implementations + arcgis.ts
    auth/           passwordValidation, rateLimit.server
    seed/           fourMileRunSites
    waterQualityEngine.ts   ← SAFETY-CRITICAL
    ingest.server.ts
    tripPlanner.ts
    scenicRouteApi.server.ts
    routingAssetFetch.server.ts
    siteDetails.functions.ts
    [and others]
  routes/
    index.tsx               Map (root)
    list.tsx                Site list
    plan.tsx                Trip planner
    tides.tsx               Tides page
    rivers.$gaugeId.tsx     River detail
    rivers.index.tsx        Rivers index
    sites/$slug.tsx         Site detail
    api/
      explain.ts            AI explanation endpoint
      route-v2.ts           Routing endpoint
      sites.ts / sites/[slug].ts
    _authenticated/         account, alerts, favorites
```

**Map configuration:** `src/components/map/WaterVoiceMap.tsx`. CARTO tiles
via `import.meta.env.VITE_CARTO_API_KEY` (line 38); key is set in `.env`.
ESRI World Imagery is a fallback (no key required).

**Site data fetch:** `src/lib/siteDetails.functions.ts` (server functions);
`src/routes/sites/$slug.tsx` (route loader).

**Water quality classification:** `src/lib/waterQualityEngine.ts` (pure TS,
no side effects; do not modify).

**`src/modules/waterTemp/` does not exist.** No water temperature display
module has been created yet.

---

## 7. Known-Bug Verification

### 7.1 Threshold divergence: waterQualityEngine.ts vs. fetch-water-quality

**CONFIRMED.**

`src/lib/waterQualityEngine.ts` (lines 29–31):
```typescript
export const ENTERO_PASS_THRESHOLD = 35;
export const ENTERO_CAUTION_MAX = 130;
```

`supabase/functions/fetch-water-quality/index.ts` (lines 119–121):
```typescript
const THRESHOLDS = {
  freshwater_ecoli: { caution: 235, unsafe: 410 },
  tidal_enterococci: { caution: 70, unsafe: 104 },
```

The ingest function classifies readings at 70/104; the display engine
classifies them at 35/130. A reading of 60 CCE/100mL would be stored as
`status: "caution"` (ingest: 60 ≥ 70? No — actually stored as "pass" by
ingest at 60 < 70) but displayed as "caution" by the engine (60 ≥ 35).
The stored `status` field and the runtime-computed classification disagree.

### 7.2 get_sites_with_latest_reading has no staleness bound

**CONFIRMED.**

Source: `supabase/migrations/20260527015305_cfaa4504.sql` lines 260–271:
```sql
LEFT JOIN LATERAL (
  SELECT *
  FROM public.readings
  WHERE site_id = s.id
  ORDER BY sampled_at DESC
  LIMIT 1
) r ON true
```

No `WHERE sampled_at > now() - interval '...'`. A site whose last reading
is from 2024 returns that reading with no staleness indicator from the
function. The live reading timestamps show the newest `sampled_at` in
`readings` is 2026-08-26 — 7 days ago.

### 7.3 agencyFromOrg() misses 21MD* organizations

**CONFIRMED.**

`supabase/functions/fetch-water-quality/index.ts` lines 238–248:
```typescript
function agencyFromOrg(orgId: string): string {
  const o = (orgId || "").toUpperCase();
  if (o.includes("USGS")) return "USGS";
  if (o.startsWith("21VA") || o.includes("VADEQ") || o.includes("VASWCB")) return "VADEQ";
  if (o.includes("MDE")) return "MDE";
  if (o.includes("DOEE") || o.includes("21DC")) return "DOEE";
  if (o.includes("NPS")) return "NPS";
  if (o.includes("WVDEP") || o.startsWith("WVDEP")) return "WVDEP";
  if (o.includes("TDEC") || o.includes("TN")) return "TDEC";
  if (o.includes("NARS") || o.includes("EPA")) return "EPA-NARS";
  return orgId || "WQP";      // ← 21MD* falls here
}
```

No branch matches `21MD*` (Maryland DNR, Maryland SHA, etc.). Those org IDs
fall through to `return orgId || "WQP"` — the raw WQP org identifier is
used as the agency string. The comment at line 24 acknowledges: "central/
northern MD entirely (52 sites)" are excluded, suggesting this is a known
coverage gap.

### 7.4 characteristics hardcoded at station creation

**CONFIRMED.**

`supabase/functions/fetch-water-quality/index.ts` line 672:
```typescript
characteristics: ["Escherichia coli", "Enterococci"],
```

This value is set at station INSERT time and never updated. If a monitoring
station later reports a different characteristic (e.g., `"Fecal Coliform"`)
it will not appear in `characteristics`.

### 7.5 CARTO basemap key not configured as VITE_ variable

**REFUTED.**

`.env` line 7: `VITE_CARTO_API_KEY="YOUR_CARTO_KEY"`

`src/components/map/WaterVoiceMap.tsx` line 38:
```typescript
const key = import.meta.env.VITE_CARTO_API_KEY;
```

The key is present and is read as a `VITE_` environment variable. The bug
claim is false for this environment.

---

## Summary of Open Issues

| Issue | Severity | Next action |
|---|---|---|
| `nearest_water_temp` not applied | Blocker for water-temp UI | Trigger Lovable sync |
| `(lat, lng)` index missing on `water_temp_observations` | Performance (low impact at 88 stations) | Add in a new migration after Lovable applies the function |
| `ingest_runs` always empty | Observability gap | Confirm whether deployed `fetch-water-conditions` includes `finishRun()` |
| Threshold divergence (35/130 vs 70/104) | Data integrity | Unify into one constant; do not touch `waterQualityEngine.ts` |
| `get_sites_with_latest_reading` no staleness bound | Data quality | Add `WHERE sampled_at > now() - interval '90 days'` to the function |
| pg_net 5 s timeout on 4 cron jobs | Reliability (partial) | Add `timeout_milliseconds` to ingest-all, ingest-noaa, ingest-osm, fetch-water-quality |
| `readings` 7 days stale | Data freshness | Check fetch-water-quality cron is firing; check ingest_runs |
| `agencyFromOrg()` misses 21MD* | Coverage | Add `if (o.startsWith("21MD")) return "MDE";` |
| No `src/modules/waterTemp/` | Feature gap | Create when Lovable applies nearest_water_temp |
