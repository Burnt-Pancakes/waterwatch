# Water Quality Data Sources

WaterWatch aggregates bacteria readings from three distinct pipelines and several site-discovery adapters. All readings are normalized to a common schema and upserted into the `readings` table with a unique constraint on `(site_id, sampled_at, data_source)`.

## Ingestion Pipelines Overview

| Pipeline | Code | Schedule | Source |
|---|---|---|---|
| **PATH A** — TanStack adapters | `src/lib/ingest.server.ts` | pg_cron daily 06:00 UTC | USGS WQP, Arlington County CSV, NOAA NWS, OSM |
| **PATH B** — `fetch-water-quality` edge function | `supabase/functions/fetch-water-quality/` | pg_cron daily 10:00 UTC | EPA WQP (bbox-tiled, E. coli + Enterococci) |
| **PATH C** — CMC residential push | `cmc_to_sql/cmc-push.mjs` → `ingest-cmc` edge fn | Windows Task Scheduler daily | CMC Data Explorer (must run from residential IP) |

---

## Active Sources

### EPA Water Quality Portal (WQP) — `fetch-water-quality` edge function (PATH B)

- **Function:** `supabase/functions/fetch-water-quality/index.ts`
- **Source URL:** `https://www.waterqualitydata.us/wqx3/Result/search` (CSV, WQX3 format)
- **Coverage:** Full DMV extent via a **contiguous `0.5°` tile grid** over `lng -83.4..-75.0, lat 36.4..39.8` (~119 total tiles, pruned to ~83 site-bearing tiles). This replaced 5 hand-drawn bounding boxes that had seams between tiles and omitted central and northern Maryland entirely.
- **Data type:** E. coli (MPN/100mL) **and Enterococci (CCE/100mL)**
- **Update frequency:** Daily CRON at 10:00 UTC (6 AM ET)
- **Lookback window:** 90 days rolling
- **Providers:** `NWIS` and `STORET` (any provider with samples in the tile)
- **Station auto-create:** WQP stations not already in `monitoring_stations` are created automatically from the coordinate and org metadata embedded in each WQX3 result row. Previously, unknown stations were silently dropped — the cause of zero MD/MDE readings.
- **Assignment backfill:** Stations with data but no `site_station_assignments` rows get assignments for active sites within `WQP_ASSIGN_RADIUS_M` (default 1500 m).

**EPA thresholds used:**

> ⚠️ **OPERATIONAL NOTE — verify with maintainer.** `fetch-water-quality/index.ts` uses tidal enterococci caution=70, unsafe=104. `waterQualityEngine.ts` and `ingest-cmc` use caution=35, unsafe=130. These represent different statistical bases and should be reconciled. See `docs/EDGE_FUNCTIONS.md` for detail.

| Water body type | Indicator | PASS | CAUTION | UNSAFE |
|---|---|---|---|---|
| Freshwater | E. coli (MPN/100mL) | < 235 | 235–410 | ≥ 410 |
| Tidal/brackish | Enterococci (CCE/100mL) | < 70 ⚠️ | 70–104 ⚠️ | ≥ 104 ⚠️ |

---

### CMC (Chesapeake Monitoring Cooperative) — residential push (PATH C)

- **Script:** `cmc_to_sql/cmc-push.mjs` (Windows Task Scheduler, daily 07:00 AM)
- **Receiver:** `supabase/functions/ingest-cmc/index.ts`
- **Source URL:** `POST https://cmc2.vims.edu/DashboardApi/FetchSamplesForDownload`
- **Coverage:** Full Chesapeake Bay dataset — **empty `watersheds` and `parameters`** in the API request body retrieve all data. Do NOT pass a `states` filter — the API returns an empty body for state-string filters.
- **Data type:** E. coli (MPN/100mL) **and Enterococci (CCE/100mL)** — both `ECOLI` and `ENT` ParameterCode prefixes are captured
- **Update frequency:** Daily (Windows Task Scheduler trigger at 07:00 AM)
- **Lookback window:** 90 days rolling (configurable via `CMC_LOOKBACK_DAYS` env var; set to `3000` for historical backfill)
- **Key field names:** Coordinates in API response are `Lat` / `Long` (NOT `Latitude` / `Longitude`)

**Why not a cloud edge function:** `cmc2.vims.edu` (Microsoft-IIS) resets TCP connections from cloud datacenter IPs (AWS, GCP, Supabase, Lambda). `cmc-push.mjs` fetches from a residential IP and POSTs to `ingest-cmc`. The `ingest-cmc` edge function itself is portable — only the outer fetch wrapper is constrained to a residential IP.

**CMC monitoring groups in the DMV:**

| GroupCode | Organization | Watershed |
|---|---|---|
| `ARK` | Anacostia Riverkeeper | Anacostia |
| `PRK` | Potomac Riverkeeper | Potomac |
| `ACB` / `ACBM` | Anacostia Community Boathouse | Anacostia |
| `FMR` | Friends of the Rappahannock | Rappahannock |
| `SHR` | Shenandoah Riverkeeper | Shenandoah |
| `TWC` | Two Creeks | — |

**EPA thresholds used (ingest-cmc):**

| Water body type | Indicator | PASS | CAUTION | UNSAFE |
|---|---|---|---|---|
| Freshwater | E. coli (MPN/100mL) | < 235 | 235–410 | ≥ 410 |
| Tidal/marine | Enterococci (CCE/100mL) | < 35 | 35–130 | ≥ 130 |

Source: EPA 2012 Recreational Water Quality Criteria (RWQC), freshwater E. coli STV (410) and tidal enterococci STV (130).

See [docs/ingestion-cmc.md](ingestion-cmc.md) for the full CMC runbook.

---

### USGS Water Quality Portal (WQP) — TanStack adapter (PATH A, legacy)

- **Adapter:** `UsgsWqpAdapter` (`usgs_wqp`)
- **URL:** `https://www.waterqualitydata.us/data/Result/search`
- **Coverage:** Potomac basin HUC-8 `02070010` — DC Metro area only
- **Data type:** E. coli (MPN/100mL) and Enterococcus (CCE/100mL)
- **Update frequency:** Runs with the daily `ingest-all` cron (06:00 UTC)
- **Lookback window:** 7 days (default)
- **Note:** Overlaps with PATH B (`fetch-water-quality`) for recent WQP readings. PATH B has a wider 90-day window and a tile grid that covers all of MD and VA, not just the Potomac HUC-8. The TanStack adapter remains as a fallback.

---

### Arlington County DES

- **Adapter:** `ArlingtonCountyAdapter` (`arlington_county`)
- **URL:** Supabase Storage bucket `arlington-data/latest.csv`
- **Coverage:** Arlington County kayak launch monitoring sites on Four Mile Run
- **Data type:** E. coli (MPN/100mL)
- **Update frequency:** Manual — CSV files placed in the bucket by the operations team
- **How accessed:** Arlington County emails CSV files; placed in the private Supabase Storage bucket. No REST API currently available.
- **TODO:** Replace with an Arlington County REST API when one becomes available.

---

### NOAA / National Weather Service — rain events

- **Adapter:** `NoaaRainAdapter` (`noaa_rain`)
- **Coverage:** Three reference stations: KDCA (Reagan National), KBWI (BWI), KDULLES (Dulles)
- **Data type:** Precipitation only — not bacteria. Writes to `rain_events` table.
- **Update frequency:** Runs with each ingestion cycle
- **What it provides:** 48-hour cumulative precipitation average across the three stations. When ≥ 1.0 inch, sets `advisory_active = true` in `rain_events`, which triggers the amber rain advisory banner in the UI.

---

### OpenStreetMap (Overpass API) — site discovery

- **Adapter:** `OsmPoiAdapter` (`osm_poi`)
- **Coverage:** DMV bounding box (~38.7°N–39.1°N, 77.5°W–76.8°W)
- **Data type:** Site discovery only — no bacteria readings
- **Update frequency:** Weekly (sites refreshed within 7 days are skipped)
- **What it provides:** Discovery of new kayak launches, boat ramps, beaches, marinas, and swim areas. Sites are upserted into the `sites` table.

---

## Standby Sources

These adapters are implemented but return `[]` from `fetchSites()` until endpoint URLs are verified.

### Open Data DC / DCGIS

- **Adapter:** `OpenDataDCAdapter` (`opendatadc`)
- **Source:** DCGIS ArcGIS REST — Recreation MapServer Layer 6
- **Coverage:** DC marinas on tidal Potomac/Anacostia
- **Status:** Disabled. Manual seed data used instead.

### Maryland DNR Boating Access

- **Adapter:** `MarylandDNRAdapter` (`mddnr`)
- **Source:** ArcGIS Online `Public_Water_Access_2020` FeatureServer
- **Coverage:** 531 MD boating access sites — Prince George's, Montgomery, Charles, Anne Arundel, Calvert, St. Mary's counties
- **Status:** ✅ Active (enabled June 2026). Sites seeded via `scripts/seedMarylandSites.ts`.

### Virginia DWR Boating Access

- **Adapter:** `VirginiaDWRAdapter` (`vadwr`)
- **Source:** ArcGIS Online `DWR_Boating_Access` FeatureServer
- **Coverage:** Northern Virginia corridor
- **Status:** Disabled. Endpoint requires verification.

---

## Data Attribution

App footer: "Data: USGS, EPA WQP, CMC, Arlington County DES. Standards: EPA 2012 RWQC, VA DEQ. Not a regulatory authority."

All AI explanations from `/api/explain` are advisory only and not regulatory determinations. Every AI response is required to end with "This is advisory only, not a regulatory determination."

---

## Standards Applied

`waterQualityEngine.ts` is the single source of truth for status classification in all UI code. EPA thresholds:

| Water body type | Indicator | PASS | CAUTION | UNSAFE |
|---|---|---|---|---|
| Freshwater | E. coli (MPN/100mL) | ≤ 235 | 236–410 | > 410 |
| Tidal/brackish | Enterococci (CCE/100mL) | ≤ 35 | 36–130 | > 130 |

Source: EPA 2012 Recreational Water Quality Criteria (RWQC). Consistent with Virginia DEQ Water Quality Standards for freshwater E. coli.

⚠️ `fetch-water-quality` uses 70/104 for tidal enterococci (not 35/130). See note above.
