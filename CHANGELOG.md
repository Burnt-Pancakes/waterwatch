# Changelog

All notable changes to WaterVoice DMV are recorded here. Dates are UTC.

---

## [2026-06-24]

### Added

- **CMC bacteria ingestion — residential-push architecture**
  - `cmc_to_sql/cmc-push.mjs`: Node.js script that fetches E. coli samples from the Chesapeake Monitoring Cooperative (CMC) API on a residential machine and POSTs them to `ingest-cmc`. Runs via Windows Task Scheduler. No npm dependencies — uses Node 18+ built-in `fetch`.
  - `supabase/functions/ingest-cmc/index.ts`: Supabase Edge Function that receives the POST payload, matches stations to paddle sites via `site_station_assignments`, applies EPA freshwater E. coli thresholds (caution ≥ 235 MPN, unsafe ≥ 410 MPN), and upserts into `readings`. Auth: `x-cron-secret` header.
  - CMC data covers Anacostia Riverkeeper, Potomac Riverkeeper, and 4 other DMV monitoring groups across Potomac, Upper Chesapeake, Lower Chesapeake, and James watersheds.
  - See [docs/ingestion-cmc.md](docs/ingestion-cmc.md) for the full runbook.

- **`fetch-water-quality` edge function** (daily WQP ingestion)
  - `supabase/functions/fetch-water-quality/index.ts`: Pulls E. coli (MPN) and Enterococci (CCE) from the EPA Water Quality Portal (`/wqx3/Result/search`, CSV) via 5 bounding boxes over DC/MD/VA.
  - 90-day rolling lookback window. `NWIS` + `STORET` providers.
  - Classifies each merged sample with EPA RWQC thresholds: freshwater E. coli (caution ≥ 235, unsafe ≥ 410 MPN) and tidal Enterococci (caution ≥ 70, unsafe ≥ 104 CFU).
  - `supabase/functions/fetch-water-quality/cmc-adapter.ts`: CMC API adapter (fetches from the cloud path; useful only from non-datacenter hosts; in practice the residential `cmc-push.mjs` is the live path for CMC data).
  - Schedule: daily CRON at 10:00 UTC via Supabase pg_cron.

- **7 DC paddle sites added** (total sites: 784)
  - District Wharf Boathouse, Anacostia Community Boathouse, Washington Canoe Club, Ballpark Boathouse, Diamond Teague Park, Kingman & Heritage Islands Park, Buzzard Point Park.
  - All classified `tidal_brackish` with `nearest_gauge_id` and `tidal_gauge_station_id` assigned.

- **`monitoring_stations` and `site_station_assignments` tables** — new tables supporting the WQP/CMC ingestion pipelines. `fetch-water-quality` upserts station metadata into `monitoring_stations` and resolves assignments into `site_station_assignments`.

### Changed

- `fetch-water-quality` `LOOKBACK_DAYS` increased from 30 → 90 to capture seasonally-collected samples.
- `supabase/functions/get-route/index.ts`: replaced live Overpass API calls with Supabase Storage–backed pre-stitched waterway GeoJSON files (7 basin files, 30-minute in-memory TTL cache). Eliminates Overpass rate limits and latency on the routing endpoint.
- Waterway routing stitch script (`scripts/stitch-routing-files.ts`): fixed component-level name locking in the union-find proximity graph. Prevents a transitive confluence node from merging differently-named rivers (e.g. Potomac absorbing Anacostia segments through an unnamed shared reach).

### Known Issues

See [KNOWN-ISSUES.md](KNOWN-ISSUES.md) for details on three open issues introduced with this release:
1. CMC station-code format mismatch (~189/361 samples/run dropped)
2. Unmatched station drops (~139 samples/run)
3. Legacy "DC Water" `readings` rows from the retired cmc-to-sql.mjs path

---

## [2026-06] (earlier)

- `MarylandDNRAdapter` enabled, pointing to ArcGIS Online `Public_Water_Access_2020` (was dead `geodata.md.gov` URL). 531 MD sites active.
- 18 NOAA tidal stations added to `river_gauges`. `fetch-tidal-predictions` edge function deployed.
- `fetch-gauge-readings` and `fetch-weather` edge functions operational with pg_cron schedules.
- `/rivers`, `/rivers/:gaugeId`, and `/tides` routes added.
- Auth (email + magic link), Favorites, Alerts, Account features added.
- AI explanation streaming via `/api/explain` (Anthropic Claude).
