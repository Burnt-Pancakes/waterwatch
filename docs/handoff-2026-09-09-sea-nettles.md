# Handoff — 2026-09-09 (sea nettles)

The sea nettle / jellyfish overlay work for this session is written up separately
by the repo owner and is **not** covered here. This document covers everything
else that changed on 2026-09-09, plus the standing rules to carry into the next
session.

---

## PART 1 — What this session changed

### 1. Schema divergence and the reconciliation squash

**What was wrong.** Between `schema_migrations` versions `20260619112853` (Jun 19)
and `20260827150825` (Aug 27) there were **no recorded migrations**, but Lovable
had added ~10 tables/views/functions and altered several existing tables through
its own internal mechanism — never through a file in `supabase/migrations/`. The
repo could not reproduce production:

- A fresh `supabase db reset` halted at the first bare `CREATE TABLE` collision
  (`20260528000001` creating `guest_alerts`, then `20260530024339` creating it
  again).
- `stage_thresholds` was granted / RLS-enabled / policied by an applied
  migration (`20260606105601`) but **created by no migration** — reset failed at
  the first `GRANT`.
- `gauge_readings` on disk still had its June schema (`gauge_id`,
  `gage_height_ft`, `discharge_cfs`, `data_source`); live is `station_id`,
  `stage_ft`, `flow_cfs`, `trend`, `qualifier`, `raw_json`.
- `sites` was missing 15 live columns, `river_gauges` 4, `readings` 1.
- 15 migration files existed in the repo that had **never been applied**.
- Pre-August migration **filenames were 1–2 s off** the `schema_migrations`
  version strings, so a reset would derive versions that permanently diverge from
  production and block CLI deploys against a rebuilt instance.

**What was done, in order:**

| commit | change |
|---|---|
| `bb82e87` | Renamed the 13 pre-August migration files so their 14-digit prefix matches the `schema_migrations` version exactly (verified: zero transcription errors against the version CSV). |
| `f514f14` | The reconciliation squash + two edited files + the held-migration relocation + 14 deletions (details below). |

**The squash** — `supabase/migrations/20260909000000_reconcile_live_schema.sql`
(applied as-is; Lovable kept the filename). One idempotent baseline placed after
everything already applied. All DDL was extracted from live
`information_schema` / `pg_catalog` on 2026-09-08 and reproduced verbatim.

- `CREATE TABLE IF NOT EXISTS` for the nine tables that had no migration file
  anywhere: `monitoring_stations`, `site_station_assignments`,
  `tidal_predictions`, `stage_thresholds`, `trips`, `trip_waypoints`,
  `weather_readings`, `weather_alerts`, `water_quality_advisories`.
- `ADD COLUMN IF NOT EXISTS` for the gap columns: `sites` +15, `river_gauges`
  +4, `readings` +1 (`monitoring_station_id` + FK + index).
- Reconciles the `sites` SELECT policy: the initial migration created
  `"Sites are publicly readable" USING (true)`; live has
  `"Official sites are publicly readable" USING (status = 'official')`. **Effect:
  anon / authenticated clients see only `status = 'official'` rows via PostgREST.**
  Personal sites (`status = 'personal'`) are reached only via `service_role` —
  `src/routes/api/sites.ts` calling the 3-arg `get_sites_with_latest_reading`
  through `supabaseAdmin`, and `src/lib/userSites.functions.ts` service-role CRUD
  scoped by `owner_id` in app code.
- `CREATE OR REPLACE` the gap functions (`get_current_tide`,
  `find_best_departure`, `calculate_trip_waypoints`, and a `DROP` of the old
  2-arg `get_sites_with_latest_reading` then the live 3-arg form) and views
  (`v_todays_tides`, `v_upcoming_tides`, both `security_invoker = true`).
- Folds in the `tidal_predictions` `'NOAA-'` prefix `UPDATE` (idempotent).

Idempotency mechanics so it is safe both on a fresh reset **and** applied to
production through Lovable: `CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT
EXISTS`, every `ADD CONSTRAINT` wrapped in a `pg_constraint` existence guard,
every `CREATE POLICY` preceded by `DROP POLICY IF EXISTS`.

**Deleted (14 files)** — each superseded by the squash or by an
already-applied Lovable migration: `20260530000001`, `20260601000001`,
`20260611191534`, `20260611192409`, `20260611193625`, `20260614082118`,
`20260617000001`, `20260617143000`, `202607040530` (also a malformed 12-digit
prefix), `20260711000001`, `20260715000000`, `20260826000000`, `20260828120000`,
`20260905130000`.

**Storage policies** (`storage.objects`) were checked against the four applied
storage migrations (`20260527022656`, `20260529162450`, `20260531234623`,
`20260619112853`) — exact match, no drift, left out of the squash. Known
pre-existing gap: the `waterways` bucket is referenced by a policy but created
by no migration (dashboard-only); a fresh reset has the policy without the
bucket.

**Current state (verified):**

- 25 files in `supabase/migrations/`, 25 distinct 14-digit prefixes.
- `schema_migrations` has exactly 25 versions: the 22 pre-`20260909` (verified
  against the CSV in the prior session) + `20260909000000` (squash) +
  `20260909130813` (CHECK fix — see §4) + `20260909173206` (cron fix — see the
  cron-outage subsection below).
- File prefixes ↔ `schema_migrations` versions: **1:1, `diff` empty**.
- No unapplied files remain in `supabase/migrations/`.

#### The 2026-09-09 cron outage (bacteria ingest)

**What happened.** The pg_cron job `fetch-water-quality-daily` was deleted and
recreated on 2026-09-05/06 (the earlier jobids no longer exist;
`cron.job_run_details` for it starts Sep 6), and the recreation dropped the
`Authorization` header from its `net.http_post` call. The Supabase functions
gateway rejects a dispatch that carries no `Authorization` / `apikey` header
**before the function runs**, so every daily run since then was a no-op.
`ingest_runs` had no `fetch-water-quality` completion from 2026-09-04 10:04
through 2026-09-09.

**How it was found.** Compared the job's `net.http_post` header against the
working `fetch-water-conditions-hourly` (job "9"), which sends
`Authorization: Bearer <publishable key>` + `x-cron-secret`; the broken job sent
only `x-cron-secret`. `net._http_response` showed 500s on those dispatches.
`cron.job_run_details` reported every run as `"succeeded"` in ~0.06 s.

**Two lessons:**

1. **`"succeeded"` in `cron.job_run_details` is dispatch-only** — it means pg_net
   accepted the `http_post`, not that the edge function ran or completed. A
   ~0.06 s duration on a job whose function takes minutes is the tell.
2. **`ingest_runs` is the only reliable completion signal** for
   `fetch-water-quality` and `fetch-water-conditions`. Check it, not cron logs,
   to confirm an ingest actually ran.

**Fix.** `eb3855a` — restored the `Authorization` header to match job "9"
exactly. Lovable applied it as `20260909173206` (our `20260909180000` removed as
a dead duplicate). Same commit also set an explicit `timeout_milliseconds`
(30000) on `fetch-gauge-readings-15min`, which had been inheriting pg_net's
5000 ms default and logging false `"Timeout of 5000 ms reached"` rows — that job
was **not** broken (it writes ~31.5k rows/24 h), pg_net was just giving up
before the response.

**Current cron state:** `fetch-water-quality-daily` — schedule `0 10 * * *`,
`timeout_milliseconds` 400000, header = `Content-Type` +
`Authorization: Bearer <publishable key>` + `x-cron-secret` (from vault via
`public._get_vault_secret('cron_secret')`).

**pg_cron job IDs change on every reschedule — always look a job up by jobname,
never by ID.** As of 2026-09-09 after these fixes:
`fetch-gauge-readings-15min` = id 13, `fetch-water-quality-daily` = id 12.

### 2. Two edited applied migrations

Both were already applied to production, so **production will not re-run them**;
the edits only change what a fresh `supabase db reset` produces. Each carries a
header block saying so.

- **`20260603032545_ec8d7966….sql`** — the `gauge_readings` `CREATE TABLE` block
  rewritten from its June shape to the live shape (`station_id` / `stage_ft` /
  `flow_cfs` / `trend` + CHECK / `qualifier` / `raw_json`, FK renamed
  `fk_gauge_readings_station`, unique constraint renamed, index renamed
  `idx_gauge_readings_station_time`). `river_gauges` and the 3-gauge seed INSERT
  unchanged. The `"Public read"` policy it still creates on `gauge_readings` is
  dropped by the squash (live keeps only `"Gauge readings are publicly
  readable"` from `20260606105601`).
- **`20260606105601_e302d54b….sql`** — the four `stage_thresholds` statements
  (`GRANT` ×2, `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`) removed. They
  failed on reset because no applied migration creates the table. The squash now
  owns `stage_thresholds`.

Neither file is verbatim history any more. The originals are in git history at
`bb82e87` and earlier.

### 3. `docs/held-migrations/20260528000001_guest_alerts_and_send_alerts.sql`

Relocated out of `supabase/migrations/` (as a `git mv`, ~61% similarity) so
`supabase db reset` no longer globs it. A rename inside the migrations directory
would not have stopped that.

It is **deliberately unapplied**. It installs:

1. A broaden of the `auth_rate_limits.kind` CHECK (superseded — see §4).
2. A second `guest_alerts` definition (superseded by the applied
   `20260530024339`, which is the live shape — no `email LIKE '%@%'` CHECK,
   indexes `idx_guest_alerts_*`).
3. `ALTER PUBLICATION supabase_realtime ADD TABLE public.readings`.
4. Vault secret `send_alerts_url` (placeholder).
5. `tg_readings_notify_alerts()` + `readings_notify_alerts_tg` — an `AFTER
   INSERT` trigger on `readings` that `pg_net`-POSTs to the send-alerts edge
   function for every inserted row.

Held because item 5 fires a network POST on every `readings` INSERT and depends
on an operator-populated vault secret; it was never green-lit. **All of its
side-effects were verified absent from production on 2026-09-08:** `pg_proc` (no
`tg_readings_notify_alerts`), `pg_trigger` (no `readings_notify_alerts_tg`),
`auth_rate_limits_kind_check` still the original 4-value CHECK, `readings` not a
member of `supabase_realtime`.

### 4. `auth_rate_limits` CHECK fix + an open `apiRoute.server.ts` change

**The bug.** `public.auth_rate_limits.kind` had a CHECK allowing only `signin`,
`signup`, `reset`, `magic_link` (from `20260527021533`). Five `/api` routes write
other values via `src/lib/apiRoute.server.ts::checkApiRateLimit`:

| route | `kind` | limit |
|---|---|---|
| `src/routes/api/sites.ts` | `api_sites` | 100 / 60 s |
| `src/routes/api/sites/[slug].ts` | `api_sites_detail` | 100 / 60 s |
| `src/routes/api/sites/[slug]/readings.ts` | `api_sites_readings` | 100 / 60 s |
| `src/routes/api/explain.ts` | `api_explain` | 10 / 1 h (calls a paid API) |
| `src/routes/api/guest-alert.ts` | `api_guest_alert` | 10 / 1 h |

Every one of those inserts failed the CHECK. `checkApiRateLimit` logs
`insertError` and falls through to `allowed: true`. The count query always
returns 0 (no row ever landed), so the threshold is never reached. **All five
routes have been fully unthrottled, fail-open, since introduction.**

**The fix — shipped.** A migration broadening the CHECK to the nine values, with
a comment table above the CHECK mapping each `kind` to its writer route and
limit (the coupling is invisible from route code). We wrote it as
`20260909120000_broaden_auth_rate_limits_kind_check.sql`; **Lovable applied it
under its own auto-generated timestamp `20260909130813` and committed a separate
file** (`20260909130813_6a9901b5-….sql`), byte-identical but for a trailing
newline. Production recorded only `20260909130813`. Our file was removed as a
dead duplicate (`8e1fefe`).

**Open — proposed, approved, NOT implemented.** `checkApiRateLimit`'s swallowed
`insertError` at `src/lib/apiRoute.server.ts:127-132` is still a silent
fail-open. Any future insert failure — a new `kind`, a permissions change, a
schema change — vanishes the same way. Approved change:

- **Throw** on SQLSTATE `23514` (check_violation) and class `42*`
  (`42P01` undefined_table, `42703` undefined_column, `42883` undefined_function,
  `42501` insufficient_privilege). These are deterministic — they fail 100 % of
  the time until code/schema is fixed, never flap — so a fail-closed 500 on the
  first request to a misconfigured route is correct and gets fixed fast.
- **Fail open, loudly** on everything else (transient infra: connection reset,
  statement timeout, pool exhaustion). Keep serving — the count query one line
  up already deliberately fails open for exactly this reason — but surface it
  (dedup'd `console.error`, or a `RateLimit-Policy: degraded` response header),
  not a bare swallowed log.

Its own commit. Not started.

### 5. Formatting / hook / CI hygiene

- **`6162299`** — pre-commit hook changed from `git add -A` to `npx
  lint-staged`. The old hook could sweep any file present in the working tree
  into a commit (it had done so once, adding `.claude/settings.json` to an
  unrelated commit). `.husky/pre-commit` is now just `npx lint-staged`.
- **`32360c4`** — `src/integrations/supabase/types.ts` and
  `previewAuthStorage.ts` added to `.prettierignore`; `types.ts` marked
  `linguist-generated=true` in `.gitattributes`. Lovable regenerates these on
  every sync with its own formatter (trailing-semicolon style), and our
  `prettier --write` was producing ~2000-line no-op diffs fighting it. Confirmed
  still churning post-fix — Lovable does not honour our `.prettierignore` — but
  our tooling no longer participates.
- **`85baee3`** — `previewAuthStorage.ts` added to `eslint.config.js` `ignores`.
  It carried a `prefer-const` violation from Lovable that was failing CI.
- **CI `ci.yml` "Auto-fix Prettier formatting" step** (lines ~33-43: `prettier
  --write` then `git add -A && git commit`, no push) was analysed: dead code now
  that the ignores cover the only files it ever touched, and the CI actor has
  zero commits in the entire git history. **Removal was proposed, NOT done** —
  the step is still live in `ci.yml`.

### Open items

- **Verify 2026-09-10 after 10:00 UTC** that the `fetch-water-quality` cron fix
  worked: `ingest_runs` should have a new `fetch-water-quality` row with
  `tiles_processed` = 83 (and `status` `ok` / `ok_with_errors`). If not, the
  gateway auth is still wrong. Do not expect a flood of `readings` — bacteria
  sources are volunteer/agency programs with real-world cadence (Potomac
  Riverkeeper ~161 rows/30d, USGS ~14, Anacostia RK ~57, VA DEQ ~1); most
  healthy daily runs upserted 0 rows. What was lost is lagged WQP arrivals, not
  samples.
- **`src/lib/apiRoute.server.ts` `checkApiRateLimit`** — throw on SQLSTATE
  `23514` and class `42*`, fail open loudly otherwise (§4). Approved, not
  started. Its own commit.
- **CI `ci.yml` "Auto-fix Prettier formatting" step** — removal proposed, not
  done (§5). Still live.

### Commit trail (this session, ours only)

```
6162299  chore: replace git add -A in pre-commit with lint-staged
e3b29a3  chore: gitignore *.tmp proof files
1e4b170  chore: lint-staged proof — untracked file must not appear in commit
aa1210c  chore: gitignore .claude/ agent settings
32360c4  chore: stop reformatting Lovable-generated Supabase files
85baee3  chore: exempt Lovable-generated previewAuthStorage.ts from ESLint
bb82e87  chore(migrations): align filenames with production schema_migrations
89d9df1  Merge branch 'main' (Lovable churn: b115d09, 73afd6e)
f514f14  chore(migrations): June-August 2026 gap reconciliation baseline
1d7ca73  fix(rate-limit): broaden auth_rate_limits kind CHECK for api_* routes
8e1fefe  chore(migrations): drop duplicate CHECK migration superseded by Lovable
fb78a74  docs: handoff for 2026-09-09 session
eb3855a  fix(cron): restore Authorization header on fetch-water-quality-daily
(this)   chore(migrations): drop duplicate cron-fix migration + patch handoff
```

Lovable commits interleaved: `b115d09`/`73afd6e` (types.ts churn), `0f463ce`/
`8aedecd` (applying the CHECK migration as `20260909130813`), `02b9acb`/`3ef1851`
(applying the cron migration as `20260909173206`).

---

## PART 2 — Standing rules, carried forward

### Carried from the Phase 5 (schema-repair) handoff

- **Column names.** Columns are `lat` / `lng` — never `lat`/`lon`,
  `latitude`/`longitude`. Site activity flag is `is_active`, not `active`.
  Bacteria columns are `e_coli_mpn` / `enterococci_cce`. Sample timestamp is
  `sampled_at`. Gauge readings use `station_id` (not `gauge_id`) and `stage_ft`
  (not `gage_height_ft`). **Never write SQL from assumed column names** — read
  `src/integrations/supabase/types.ts` or query `information_schema` first. This
  has gone wrong repeatedly.
- **A git push is not a deploy.** Migrations and edge functions apply only when
  Lovable is asked in chat and syncs. `Publish` deploys the frontend only. After
  any migration, verify it landed with `pg_get_functiondef` /
  `information_schema` / a live RPC probe before treating it as live.
- **`types.ts` is the authoritative schema source.** Regenerated by Lovable on
  every schema change. Never hand-edit it. If it conflicts with a migration
  file, trust `types.ts`.
- **When you report query results, show the exact query you ran.** Show actual
  file contents and actual command output, not summaries of them.
- **Lovable credits are constrained.** Diagnosis, SQL, and probing happen here
  or in the Supabase SQL editor (free). Lovable is only for applying a migration
  or changing an edge function / cron.
- **`git pull origin main` before starting any session.** Sync is one-way
  (Lovable → GitHub). Local `main` is stale after any Lovable session.
- **`waterQualityEngine.ts` is SAFETY-CRITICAL** — pure, no side effects, no
  threshold changes without citing the regulation. Water-temp and similar
  advisory layers never render the word "safe" — the lowest band is "Lower
  risk."
- **If something the user describes doesn't match the tree, say so** rather than
  reconciling it silently.

### New this session

- **Every Lovable request that touches schema must ask for a migration file** —
  never "add a column" / "change this table" as a bare instruction. Express the
  change as an idempotent file under `supabase/migrations/`. This is now also
  recorded in Lovable's project **Knowledge** panel.
- **Lovable's completion reports are not evidence.** Verify every schema change
  directly in the database: `schema_migrations` **plus** a catalog query showing
  the new state (`information_schema.columns`, `pg_constraint`, `pg_policies`,
  `pg_proc`, …). This session Lovable reported two completed actions that had
  not happened.
- **Lovable applies a provided migration under its own auto-generated
  timestamp**, committing a duplicate file for the same change. This has now
  happened **twice in three applies** this session — `20260909130813` for the
  CHECK fix, `20260909173206` for the cron fix; only the squash
  (`20260909000000`) kept its filename. After **every** Lovable apply, compare
  every migration filename's 14-digit prefix against the `schema_migrations`
  versions and `git rm` the duplicate — the file whose prefix `schema_migrations`
  recorded is the one that stays.
- **Verification steps are deliverables.** If you skipped one, say "skipped" —
  do not omit it.
- **Verify the commit message against the diff before committing.**
