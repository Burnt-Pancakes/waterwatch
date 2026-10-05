# Edge Functions

Supabase Deno Edge Functions. These run in **Lovable's Supabase project only** — they are NOT deployed from GitHub. The files in `supabase/functions/` are reference copies; the canonical versions live in the Lovable Supabase dashboard.

To update an Edge Function:
1. Edit it in the Lovable Supabase dashboard → Edge Functions, **or**
2. Ask Lovable to update it via chat (more reliable for logic changes)

Do NOT edit `supabase/functions/` and push to GitHub expecting the change to go live — it won't.

---

## `fetch-water-conditions`

| Property | Value |
|---|---|
| Trigger | pg_cron `5 * * * *` (hourly at :05) + manual POST with `x-cron-secret` |
| Source APIs | USGS OGC API v0 (`/ogcapi/v0/collections/latest-continuous`, `parameter_code=00010`) and CBIBS (`mw.buoybay.noaa.gov/api/v1`) |
| Target table | `water_temp_observations`, `ingest_runs` |
| Conflict key | `(source, station_code, observed_at)` — idempotent upsert |
| Auth | `x-cron-secret` header |

**What it does (in order):**

1. Fetches all water temperature stations from USGS OGC `latest-continuous` for the full DC/MD/VA bounding box (`-79.5,37.0,-75.0,39.8`).
2. Filters to surface-water site types: ST (prefix-match, so ST-TS and ST-CA are included), ES, LK. A `MAX_READING_AGE_HOURS = 6` guard rejects readings with timestamps older than 6 hours — USGS `latest-continuous` can return readings from years ago for sensors with stale approval status.
3. Validates `temp_c` in range `[-5, 45]` °C; rejects outliers.
4. Upserts into `water_temp_observations`.
5. Attempts a CBIBS fetch (Bay buoy network). CBIBS failure is non-fatal — the function succeeds on USGS alone.
6. Writes one row to `ingest_runs` with `function_name = 'fetch-water-conditions'`, status, and row counts.

**Site-type handling:** The USGS monitoring-locations API uses exact-match filtering for `site_type_code`. ST-TS (tidal streams) and ST-CA (canals) are subtypes of ST and require explicit separate API requests; they are NOT returned by a single `site_type_code=ST` request. The function loops over `["ST", "ST-TS", "ST-CA", "ES", "LK"]` to capture all surface-water station types. This was a bug-fix in commit `9b823cd`.

**Temperature storage:** Always stored in Celsius (`temp_c`). Display conversion to °F happens in the UI.

**Env vars:**

| Var | Required | Notes |
|---|---|---|
| `USGS_API_KEY` | No | Falls back to anonymous USGS quota if absent |
| `CBIBS_API_KEY` | No | CBIBS fetch is skipped if key is absent |

---

## `fetch-water-quality`

| Property | Value |
|---|---|
| Trigger | pg_cron `0 10 * * *` (daily 10:00 UTC / 6 AM ET) + manual POST with `x-cron-secret` |
| Source API | EPA Water Quality Portal (WQP) — `wqx3/Result/search`, CSV |
| Target table | `readings`, `monitoring_stations`, `site_station_assignments` |
| Conflict key | `(site_id, sampled_at, data_source)` |
| Auth | `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` or `x-cron-secret` header |

**What it does (in order):**

1. Loads all active `monitoring_stations` and their `site_station_assignments`.
2. Loads all active sites with coordinates; prunes the tile grid to only tiles near a site.
3. For each site-bearing tile, queries WQP for E. coli and Enterococci results (90-day window, `NWIS`+`STORET` providers, CSV format).
4. **Station auto-create:** any station code returned by WQP that is not already in `monitoring_stations` is inserted using the coordinate and org metadata embedded in each WQX3 result row. Previously these were silently dropped.
5. **Assignment backfill:** stations that now have data but no `site_station_assignments` rows get assignments created for active sites within `WQP_ASSIGN_RADIUS_M` (default 1500 m).
6. Merges E. coli and Enterococci rows for the same station + timestamp into a single event.
7. Classifies with EPA thresholds (see below) and upserts into `readings` in batches of 500.
8. Updates `monitoring_stations.last_sample_at` for each touched station.

**Tiled grid:** A contiguous `0.5°` grid over `lng -83.4..-75.0, lat 36.4..39.8` generates ~119 tiles; the function prunes to ~83 site-bearing tiles (±0.25° margin around each active site). This replaced 5 hand-drawn bounding boxes that had seams and omitted central/northern MD.

**Retry:** Each tile is attempted up to `WQP_RETRIES` times (default 3) with linear backoff (1s, 2s) on 5xx errors. 4xx responses are not retried.

**Configurable env vars (all have defaults):**

| Var | Default | Effect |
|---|---|---|
| `WQP_TILE_DEG` | `0.5` | Tile size in degrees. Larger = fewer requests, each heavier. |
| `WQP_RETRIES` | `3` | Per-tile retry count on 5xx. |
| `WQP_TILE_PAUSE_MS` | `300` | Pause between tiles (ms) to avoid self-induced overload. |
| `WQP_ASSIGN_RADIUS_M` | `1500` | Max site-station assignment radius for backfill. |
| `WQP_WEST/SOUTH/EAST/NORTH` | see above | Grid extent overrides. |

**EPA classification thresholds:**

> ⚠️ **OPERATIONAL NOTE — verify with maintainer.** `fetch-water-quality/index.ts` uses `tidal_enterococci: { caution: 70, unsafe: 104 }`, which differs from `waterQualityEngine.ts` and `ingest-cmc/index.ts` (both use 35/130). The 70/104 values correspond to the EPA Beach Action Value (BAV) and marine single-sample STV; the 35/130 values are the EPA RWQC geometric-mean criterion and STV. These represent different statistical bases and should be reconciled.

| Water type | Indicator | CAUTION ≥ | UNSAFE ≥ |
|---|---|---|---|
| Freshwater (`is_tidal=false`) | E. coli (MPN/100mL) | 235 | 410 |
| Tidal/estuarine (`is_tidal=true`) | Enterococci (CCE/100mL) | 70 ⚠️ | 104 ⚠️ |

`is_tidal` comes from the `monitoring_stations` row, not the site. If a tidal station has no Enterococci reading, it falls back to E. coli thresholds (and vice versa for freshwater).

**CMC via cmc-adapter.ts:** `fetch-water-quality` also imports `./cmc-adapter.ts` and attempts a cloud-path CMC fetch as SOURCE 2. In practice this path succeeds only from non-datacenter IPs; the residential `cmc-push.mjs` + `ingest-cmc` is the production CMC path.

---

## `ingest-cmc`

| Property | Value |
|---|---|
| Trigger | HTTP POST from `cmc-push.mjs` (residential machine, Windows Task Scheduler) |
| Source | CMC samples pre-fetched by `cmc_to_sql/cmc-push.mjs` |
| Target table | `readings`, `monitoring_stations`, `site_station_assignments` |
| Conflict key | `(site_id, sampled_at, data_source)` |
| Auth | `x-cron-secret` header must equal `CRON_SECRET` env var |
| Batch size | 200 per `readings` upsert batch |

**Request body:**
```json
{
  "samples": [
    {
      "stationCode": "ARK.AR.2",
      "sampledAt": "2026-05-28T08:53:00.000Z",
      "indicator": "ecoli",
      "value": 1046.2,
      "ecoliMpn": 1046.2,
      "groupCode": "ARK",
      "parameterCode": "ECOLI.8",
      "sampleId": "1",
      "latitude": 38.8774,
      "longitude": -77.0246,
      "rawRow": { ... }
    }
  ]
}
```

`indicator` and `value` are the new fields (supported by current `cmc-push.mjs`). `ecoliMpn` is kept for backward compatibility with older push clients.

**4-stage station-matching cascade** (all done in memory after a single bulk load):

| Stage | Method | What it does |
|---|---|---|
| 1 — EXACT | One `LIKE 'CHESAPEAKEMONITORINGCOOP-CMC.%'` query loads all CMC stations | Matches incoming code exactly after stripping the prefix |
| 2 — NORMALIZED | Same loaded set | Normalizes hyphens→dots and uppercases both sides; matches `PRK.PR-10` to `PRK.PR.10` |
| 3 — COORDINATE | All stations with lat/lng | Nearest existing station of any source within 100 m of sample coordinates |
| 4 — CREATE | Remaining unresolved codes with known coordinates | Creates new `monitoring_stations` rows using sample coordinates |

After matching, any resolved station with no `site_station_assignments` rows gets assignments created for active sites within `ASSIGN_RADIUS_M` (default 1500 m, overridable via env var).

**Enterococci + event merging:** Both E. coli and Enterococci samples from CMC are now processed. Samples sharing the same station + `sampledAt` are merged into a single reading row carrying both `e_coli_mpn` and `enterococci_cce`. `status` is the worst of whichever indicators are present.

**EPA thresholds (freshwater E. coli):**

| Result | Threshold |
|---|---|
| `pass` | E. coli < 235 MPN/100mL |
| `caution` | 235 ≤ E. coli < 410 MPN/100mL |
| `unsafe` | E. coli ≥ 410 MPN/100mL |

**Enterococci thresholds (tidal/marine):**

| Result | Threshold |
|---|---|
| `pass` | Enterococci < 35 CCE/100mL |
| `caution` | 35 ≤ Enterococci < 130 CCE/100mL |
| `unsafe` | Enterococci ≥ 130 CCE/100mL |

**Response summary JSON:**
```json
{
  "received": 4700,
  "matched_exact": 37,
  "matched_normalized": 19,
  "matched_coord": 21,
  "stations_created": 90,
  "assignments_created": 142,
  "matched_stations": 167,
  "inserted": 3841,
  "skipped_no_station": 0,
  "skipped_no_site": 312,
  "errors": []
}
```

See [docs/ingestion-cmc.md](ingestion-cmc.md) for the full CMC runbook.

---

## `fetch-gauge-readings`

| Property | Value |
|---|---|
| Trigger | Supabase cron `*/15 * * * *` (every 15 min) + manual POST |
| Source API | USGS Instantaneous Values API |
| Target table | `gauge_readings` |
| Conflict key | `(station_id, recorded_at)` |

Fetches current stage and flow for all `river_gauges` rows where `usgs_site_number` does NOT start with `NOAA-`. Calls the USGS IV API in batches of up to 100 sites. Upserts rows with `station_id`, `stage_ft`, `flow_cfs`, `trend`, `qualifier`, and `raw_json`.

`trend` is computed from the most recent two values: `"rising"` / `"falling"` / `"steady"` (threshold: ±0.1 ft).

---

## `fetch-tidal-predictions`

| Property | Value |
|---|---|
| Trigger | Supabase cron `0 */6 * * *` (every 6 hours) + manual POST |
| Source API | NOAA CO-OPS API |
| Target table | `tidal_predictions` |
| Conflict key | `(noaa_station_id, predicted_at)` |

Fetches the next 72 hours of tidal H/L predictions for all distinct `noaa_station_id` values in `river_gauges` (18 NOAA stations). Upserts `noaa_station_id`, `predicted_at`, `type` (`H` or `L`), `height_ft`, `fetched_at`.

The `/tides` page queries `tidal_predictions` directly — it does NOT call NOAA at page-load time.

---

## `fetch-weather`

| Property | Value |
|---|---|
| Trigger | Supabase cron `0 * * * *` (every 1 hour) + manual POST |
| Source API | NWS API (National Weather Service) |
| Target tables | `weather_readings`, `weather_alerts`, `rain_events` |
| Coordinates | 38.8951°N, 77.0364°W (central DC) |

Fetches the next 12 hourly forecast periods from the NWS API.

- `weather_readings` — upserted on `observed_at`; stores `wind_speed_mph`, `wind_direction_text`, `wind_direction_deg`, `precip_probability_pct`, `short_forecast`, `temperature_f`, `raw_json`, `fetched_at`
- `weather_alerts` — upserted on `nws_alert_id`; stores alert details truncated to 500 chars
- `rain_events` — one row per run when max precipitation probability in next 6 hours > 40%; `advisory_active = true` when > 60%

---

## `send-alerts`

| Property | Value |
|---|---|
| Trigger | Postgres DB trigger on `readings` INSERT (`tg_readings_notify_alerts`) |
| Email provider | Resend |

Called via `pg_net.http_post` from the trigger function after each new `readings` INSERT. Looks up `alerts` and `guest_alerts` for the site, evaluates whether the new status matches the subscription's `trigger_on` array, and sends email via Resend if so. Skips when the vault URL still contains the `REPLACE_ME` placeholder.

---

## `send-weekly-feedback` (server route, not an edge function)

| Property | Value |
|---|---|
| Trigger | pg_cron `0 13 * * 1` (Mondays 13:00 UTC) + manual POST |
| Location | `src/routes/api/public/send-weekly-feedback.ts` — new edge functions cannot be created in this project, so this report runs as a TanStack public server route |
| Source table | `preview_feedback` (last 7 days, by `created_at`) |
| Email provider | Resend (`RESEND_API_KEY`, `EMAIL_FROM` — same sender as `send-alerts`) |
| Auth | `x-cron-secret` header equal to `CRON_SECRET`, or a service-role Bearer token |

Groups rows by `prompt_key`, renders each question as an Option/Count/Percent table (percent denominator is distinct `device_id` per prompt, so multi-select questions can exceed 100%), lists every non-empty `response_text` verbatim, and emails the digest to rajivsundar@gmail.com. Questions with no rows show "No responses this week." See [docs/HOW-TO-END-WEEKLY-FEEDBACK.md](HOW-TO-END-WEEKLY-FEEDBACK.md) to stop it.

---

## pg_cron Schedules

Cron jobs live in Lovable's Supabase project. The `ingest-all/noaa/osm` jobs were registered in migrations `20260527023446` and `20260527023506`. The `fetch-water-quality` job was registered in migration `202607040530_schedule_fetch_water_quality.sql` using a direct edge-function URL (not the stalled Lovable preview URL).

| Job name | Expression | What it triggers |
|---|---|---|
| `ingest-all` | `0 6 * * *` | `POST /api/public/ingest` (PATH A TanStack adapters) |
| `ingest-noaa` | `0 */6 * * *` | `POST /api/public/ingest?source=noaa` |
| `ingest-osm` | `0 4 * * 1` | `POST /api/public/ingest?source=osm` |
| `fetch-gauge-readings` | `*/15 * * * *` | `fetch-gauge-readings` edge function |
| `fetch-tidal-predictions` | `0 */6 * * *` | `fetch-tidal-predictions` edge function |
| `fetch-weather` | `0 * * * *` | `fetch-weather` edge function |
| `fetch-water-quality-daily` | `0 10 * * *` | `fetch-water-quality` edge function (`timeout_milliseconds: 400000`) |
| `fetch-water-conditions-hourly` | `5 * * * *` | `fetch-water-conditions` edge function (water temperature) |
| `prune-water-temp-observations-daily` | `20 3 * * *` | `DELETE FROM water_temp_observations WHERE observed_at < now() - interval '90 days'` |
| `waterwatch-weekly-feedback` | `0 13 * * 1` | `POST /api/public/send-weekly-feedback` on the stable project URL (weekly focus-group digest email). After US daylight time ends Nov 1 2026, change to `0 14 * * 1` to stay at 9am ET. |

`ingest-cmc` has no pg_cron entry — it is triggered externally by `cmc-push.mjs` via Windows Task Scheduler on a residential machine. See [docs/ingestion-cmc.md](ingestion-cmc.md).

> **Note:** The `ingest-all`, `ingest-noaa`, and `ingest-osm` jobs target the Lovable preview server URL stored in the `ingest_url` vault secret. If that server is cold or unreachable, these jobs silently fail. The `fetch-water-quality` job targets the stable edge-function URL directly and is not affected by this issue.
