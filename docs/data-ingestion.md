# Data Ingestion

The ingestion system pulls water quality data from external sources, normalizes it, computes status via the water quality engine, and upserts results into the `readings` table. Runs are idempotent via the unique constraint `(site_id, sampled_at, data_source)`.

There are three ingestion paths:

| Path | What runs it | Reads from | Target |
|---|---|---|---|
| **PATH A** (TanStack adapters) | pg_cron → `/api/public/ingest` | USGS WQP, Arlington CSV, NWS, OSM, MD DNR, VA DWR | `readings`, `sites`, `rain_events` |
| **PATH B** (Edge Function — WQP) | pg_cron daily 10:00 UTC | EPA WQP `/wqx3/`, 90-day, 5 bbox tiles | `readings`, `monitoring_stations` |
| **PATH C** (Residential push — CMC) | Windows Task Scheduler → `cmc-push.mjs` → `ingest-cmc` | CMC `cmc2.vims.edu` (datacenter IPs blocked) | `readings` |

This document covers **PATH A** (the TanStack adapter system). For PATH B and PATH C see [docs/EDGE_FUNCTIONS.md](EDGE_FUNCTIONS.md) and [docs/ingestion-cmc.md](ingestion-cmc.md).

---

## Orchestrator

**File:** `src/lib/ingest.server.ts`

### `runIngestion(sourceId?, overrideAdapters?)`

Top-level orchestrator. Pass a `sourceId` (e.g. `"noaa_rain"`) to run a single adapter, or omit to run all configured adapters.

Returns `IngestionResult`:
```typescript
type IngestionResult = {
  sourcesRun: string[];
  readingsInserted: number;
  readingsSkipped: number;
  errors: Array<{ source: string; message: string }>;
}
```

### `buildDefaultAdapters()`

Returns the 7-adapter set. Exposed separately so tests can substitute fakes.

```typescript
[
  new UsgsWqpAdapter(),
  new ArlingtonCountyAdapter(supabaseAdmin),
  new NoaaRainAdapter(supabaseAdmin),
  new OsmPoiAdapter(supabaseAdmin),
  new OpenDataDCAdapter(supabaseAdmin),
  new MarylandDNRAdapter(supabaseAdmin),
  new VirginiaDWRAdapter(supabaseAdmin),
]
```

### `persistReadings(adapter, readings, siteIndex)`

Takes normalized `AdapterReading[]`, matches each to a known site via `siteIndex` (keyed on `osm_id`), calls `getWaterStatus` to compute the display status, then bulk-upserts into `readings`. Skips readings for unknown sites and readings where both `eColiMpn` and `enterococciCce` are null.

### Adapter filter IDs

```typescript
export const ADAPTER_FILTER_IDS = {
  usgs: "usgs_wqp",
  arlington: "arlington_county",
  noaa: "noaa_rain",
  osm: "osm_poi",
  opendatadc: "opendatadc",
  mddnr: "mddnr",
  vadwr: "vadwr",
}
```

---

## Adapter Interface

**File:** `src/lib/adapters/base.ts`

```typescript
interface DataSourceAdapter {
  sourceId: string;       // e.g. "usgs_wqp"
  displayName: string;
  fetchSites(): Promise<AdapterSite[]>;
  fetchReadings(siteId: string, since: Date): Promise<AdapterReading[]>;
  normalize(raw: unknown): AdapterReading;
}
```

Adapters call the network and parse responses but do NOT write to the database. The orchestrator owns persistence.

---

## Adapters

### UsgsWqpAdapter (`usgs_wqp`)

**File:** `src/lib/adapters/usgsWqpAdapter.ts`

**Source:** USGS Water Quality Portal (WQP) — https://www.waterqualitydata.us/data/Result/search

**Coverage:** Potomac basin HUC-8 `02070010` (DC Metro area)

**What it fetches:** E. coli and Enterococcus results via `dataProfile=resultPhysChem`. Makes two parallel requests — one per `characteristicName` — and combines results.

**How it works:**
- `buildUrl(characteristic, since)` constructs a WQP URL with `huc`, `characteristicName`, `startDateLo`, and `mimeType=json`.
- `fetchReadings` fetches both characteristics and maps each row through `normalize`.
- `normalize` inspects `CharacteristicName` to decide whether the value goes in `eColiMpn` or `enterococciCce`.
- `combineWqpDateTime(date, time)` merges WQP's separate date + time fields into an ISO string (treating time as UTC; missing time defaults to 00:00:00).
- `parseWqpValue(v)` parses `ResultMeasureValue` to a finite number or null.
- `fetchSites` returns `[]` — WQP sites are not auto-upserted; sites come from the OSM adapter and manual seed.

**Constructor:** accepts an injectable `fetchImpl` for test mocking.

---

### ArlingtonCountyAdapter (`arlington_county`)

**File:** `src/lib/adapters/arlingtonCountyAdapter.ts`

**Source:** Supabase Storage bucket `arlington-data` / `latest.csv`

**Coverage:** Arlington County kayak launch monitoring program

**What it fetches:** A CSV file manually placed in private Supabase Storage by the operations team. There is no REST API yet; the team emails CSV files.

**Required CSV columns:** `SiteID`, `SiteName`, `SampleDate`, `EColi_MPN`, `Latitude`, `Longitude`

**How it works:**
- `fetchReadings` downloads `latest.csv` from `arlington-data` bucket via the admin Supabase client.
- `parseCsv(text)` — a built-in RFC 4180-ish CSV parser (handles quoted fields with commas and escaped double-quotes `""`). No external CSV dependency.
- `isValidArlingtonRow(row)` — validates all required columns are non-empty.
- Rows are filtered by the `since` cutoff before returning.
- `normalize` maps `EColi_MPN` to `eColiMpn`; `enterococciCce` is always null.
- `sampleMethod` is hardcoded to `"Arlington County volunteer monitoring"`.

**Constructor:** accepts injectable `supabase`, `objectPath` (default `"latest.csv"`), and `logger`.

---

### NoaaRainAdapter (`noaa_rain`)

**File:** `src/lib/adapters/noaaRainAdapter.ts`

**Source:** NOAA / NWS Observations API — https://api.weather.gov

**Coverage:** Three reference stations: `KDCA` (Reagan National), `KBWI` (BWI), `KDULLES` (Dulles)

**What it fetches:** 48-hour precipitation totals, not bacteria readings. This adapter writes to `rain_events`, not `readings`.

**How it works:**
- For each station, fetches `https://api.weather.gov/stations/{station}/observations`.
- `sumLast48h(collection, now)` sums `precipitationLast6Hours` values from observations within the last 48h.
- `metricToInches(value, unitCode)` converts NWS metric values (mm or m) to inches.
- Averages the per-station totals (failed stations are excluded, not treated as zero; if all fail, throws).
- Writes one row to `rain_events` with the average and `advisory_active = avg >= 1.0`.
- Returns `[]` from `fetchReadings` — this adapter produces no `AdapterReading` objects.

**Constructor:** accepts injectable `supabase`, `fetchImpl`, and `nowFn` for testing.

---

### OsmPoiAdapter (`osm_poi`)

**File:** `src/lib/adapters/osmPoiAdapter.ts`

**Source:** OpenStreetMap Overpass API — https://overpass-api.de/api/interpreter

**Coverage:** DMV bounding box `[38.7, -77.5, 39.1, -76.8]` (south, west, north, east)

**What it fetches:** Water-recreation POIs. This adapter discovers and upserts sites, not readings.

**OSM tags queried:** `amenity=boat_ramp`, `amenity=canoe_rental`, `leisure=marina`, `leisure=beach`, `leisure=water_park`, `sport=kayak`, `sport=swimming`

**Tag-to-site-type mapping (`osmTagsToSiteType`):**
| OSM tag | `site_type` |
|---|---|
| `amenity=boat_ramp` | `boat_ramp` |
| `amenity=canoe_rental` | `kayak_launch` |
| `leisure=marina` | `marina` |
| `leisure=beach` | `beach` |
| `leisure=water_park` | `swim_area` |
| `sport=kayak` | `kayak_launch` |
| `sport=swimming` | `swim_area` |

**How it works:**
- `buildOverpassQuery(bbox)` generates the Overpass QL query.
- Unnamed POIs are skipped (`el.tags?.name` must be non-empty).
- All discovered sites default to `waterBodyType = "freshwater"` (editors can override in the DB if the site is actually tidal).
- Calls `persistDiscoveredSites` which upserts on `osm_id` and skips sites refreshed within `OSM_REFRESH_DAYS` (7 days).
- Returns `[]` from `fetchReadings` — OSM has no bacteria readings.

**Constructor:** accepts injectable `supabase`, `fetchImpl`, and `nowFn`.

---

### OpenDataDCAdapter (`opendatadc`)

**File:** `src/lib/adapters/openDataDCAdapter.ts`

**Source:** DCGIS ArcGIS REST — Recreation MapServer Layer 6 (Marinas)

**Status:** DISABLED. `fetchSites` logs a warning and returns `[]`. The endpoint URL requires verification before the adapter is re-enabled; manual seed data is used instead.

**What it would fetch:** DC marinas from the DCGIS Recreation layer. All DC marinas are `tidal_brackish`.

**`mapDcMarinaFeature(f)`** — maps an ArcGIS feature to `AdapterSite`. External ID format: `opendatadc:marina:{OBJECTID}`.

---

### MarylandDNRAdapter (`mddnr`)

**File:** `src/lib/adapters/marylandDNRAdapter.ts`

**Source:** ArcGIS Online — `services.arcgis.com/.../Public_Water_Access_2020/FeatureServer/0/query`

**Status:** ✅ ENABLED (updated June 2026). Fetches live from ArcGIS Online. 531 MD sites seeded.

**Coverage:** 6 MD counties: Prince George's, Montgomery, Charles, Anne Arundel, Calvert, St. Mary's

**Classification logic (`classifyMdSite(boatRamp, softAccess, waterBody)`):**
- `BoatRamp != "Yes"` AND `SoftAccess == "Yes"` → `kayak_launch`; otherwise → `boat_ramp`
- `WaterBody` containing "potomac" or "chesapeake" → `tidal_brackish`; otherwise → `freshwater`

**Field mapping:** `SiteName` → `name`, `BoatRamp` → ramp flag, `SoftAccess` → soft launch flag, `WaterBody` → water body name

**External ID format:** `mddnr:site:{OBJECTID}`

---

### VirginiaDWRAdapter (`vadwr`)

**File:** `src/lib/adapters/virginiaDWRAdapter.ts`

**Source:** ArcGIS Online — `DWR_Boating_Access` FeatureServer

**Status:** DISABLED. `fetchSites` logs a warning and returns `[]`. Endpoint requires verification.

**Coverage:** Northern Virginia corridor `[-77.5, 38.7, -77.0, 39.0]`

**Classification logic (`vaWaterBodyType`):**
- Sites with `lng >= -77.1` AND `lat` in `[38.7, 39.0]` → `tidal_brackish` (Alexandria/Mt Vernon corridor)
- All others → `freshwater`

All VA DWR sites are typed as `boat_ramp` by default.

**External ID format:** `vadwr:site:{OBJECTID}`

---

## Ingestion Trigger

`/api/public/ingest` is called by Supabase `pg_cron` via `pg_net.http_post`. It requires `Authorization: Bearer <CRON_SECRET>`. The secret comparison uses a constant-time algorithm to prevent timing attacks. See [docs/api-routes.md](api-routes.md) for details.
