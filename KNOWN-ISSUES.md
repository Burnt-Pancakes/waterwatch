# Known Issues

Last updated: July 2026. Each issue notes severity, affected component, and current status.

---

## KI-003 — Legacy "DC Water" Readings from Retired cmc-to-sql.mjs

**Status:** Open

**Severity:** Low — cosmetic / data-quality issue

**Component:** `readings` table

**Symptom:** The `readings` table contains a small number of rows with `data_source = 'DC Water'` or similar legacy labels inserted by the now-retired `cmc-to-sql.mjs` manual SQL-paste script.

**Root cause:** `cmc-to-sql.mjs` assigned custom `data_source` labels that do not match the normalized `GroupCode`-derived labels used by `ingest-cmc` (e.g. `Anacostia Riverkeeper`, `Potomac Riverkeeper`). Because `readings` deduplicates on `(site_id, sampled_at, data_source)`, these old rows are not overwritten by new `ingest-cmc` runs — they coexist as additional rows for the same sample.

**Fix:** Run a one-time SQL migration to re-label the legacy rows to the correct `data_source` value, or delete them and allow `ingest-cmc` to re-insert with the correct label on the next run.

**Workaround:** Legacy rows display the correct safety status (computed from the same E. coli values); only the attribution label is incorrect.

---

## Resolved Issues

### ~~KI-001 — CMC Station-Code Format Mismatch~~ ✅ Resolved Jul 2026

**Was:** Each `ingest-cmc` run dropped ~52% of samples with `skipped_no_station` because the CMC API returns short station codes with hyphens (`PRK.PR-4`) while `monitoring_stations` stored full WQP identifiers with dots (`CHESAPEAKEMONITORINGCOOP-CMC.PRK.PR.4`).

**Fix:** `ingest-cmc` now uses a **4-stage station-matching cascade** done entirely in memory after a single `LIKE 'CHESAPEAKEMONITORINGCOOP-CMC.%'` bulk load:
1. **EXACT** — strip prefix, compare exactly
2. **NORMALIZED** — hyphens→dots, uppercase both sides (resolves `PRK.PR-10` → `PRK.PR.10`)
3. **COORDINATE** — nearest existing station within 100 m
4. **CREATE** — create new station from sample coordinates

`skipped_no_station` should now be 0 for all known CMC codes.

---

### ~~KI-002 — Unmatched Station Drops (No Site Assignment)~~ ✅ Resolved Jul 2026

**Was:** After matching stations, `ingest-cmc` dropped samples with `skipped_no_site` because no row in `site_station_assignments` connected the station to a paddle site.

**Fix:** Both `ingest-cmc` (Stage 4 of cascade) and `fetch-water-quality` now include **assignment backfill**: after matching or creating a station, they query active sites within `ASSIGN_RADIUS_M` (default 1500 m) and create any missing `site_station_assignments` rows. Stations genuinely farther than 1500 m from any paddle site still appear in `skipped_no_site` — that is expected behavior, not a bug.

---

### ~~KI-004 — cmc-push.mjs Had Hardcoded CRON_SECRET~~ ✅ Resolved Jul 2026

**Was:** `cmc-push.mjs` contained hardcoded `INGEST_URL` and `CRON_SECRET` values as string literals, creating a secret exposure risk if the file was committed to a public repo.

**Fix:** Both values are now loaded via `node --env-file=.env` from `cmc_to_sql/.env` (gitignored). The script validates on startup that both env vars are set and exits with an error if either is missing. The previous hardcoded secret has been rotated.
