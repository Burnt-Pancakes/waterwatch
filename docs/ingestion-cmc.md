# CMC Ingestion Runbook

CMC (Chesapeake Monitoring Cooperative) bacteria samples cannot be fetched from a cloud function because `cmc2.vims.edu` (Microsoft-IIS) resets TCP connections from datacenter IPs. The solution is a split architecture:

```
Residential machine (Windows Task Scheduler, daily 07:00 AM)
  └─→ cmc_to_sql/cmc-push.mjs
        ├─ POST https://cmc2.vims.edu/DashboardApi/FetchSamplesForDownload
        │      (full-bay fetch, all watersheds, all bacteria indicators)
        └─ POST https://nchorqfnmbngewnhgcvh.supabase.co/functions/v1/ingest-cmc
              (x-cron-secret auth, batches of 500 samples)
                └─→ 4-stage station matching + assignment backfill
                      + EPA classification + upsert → readings
```

---

## Files

| File | Purpose |
|---|---|
| `cmc_to_sql/cmc-push.mjs` | Residential fetch client. No npm install needed (Node 22+ built-in `fetch`). |
| `cmc_to_sql/.env` | Local secrets (gitignored). Copy `.env.example` and fill in. |
| `cmc_to_sql/cmc-to-sql.mjs` | Retired predecessor — manual SQL-paste approach. Do not use. |
| `supabase/functions/ingest-cmc/index.ts` | Supabase Edge Function receiver. Reference copy — deploy via Lovable dashboard. |
| `supabase/functions/fetch-water-quality/cmc-adapter.ts` | Cloud-path CMC adapter used by `fetch-water-quality`. Shares CMC API constants. |

---

## Environment Variables

### `cmc_to_sql/.env` (residential machine)

Never hardcode secrets. Both values below are loaded via `node --env-file=.env`.

| Variable | Description |
|---|---|
| `INGEST_URL` | Full URL of the `ingest-cmc` edge function: `https://nchorqfnmbngewnhgcvh.supabase.co/functions/v1/ingest-cmc` |
| `CRON_SECRET` | Shared secret verified by `ingest-cmc` via `x-cron-secret` header. Must match the Supabase vault value. |

Optional:

| Variable | Default | Description |
|---|---|---|
| `CMC_LOOKBACK_DAYS` | `90` | Rolling window. Set to `3000` for a full historical backfill. |
| `CMC_PUSH_BATCH` | `500` | Samples per POST batch. Smaller = safer for edge function wall-clock limits. |
| `CMC_WATERSHEDS` | `""` (all) | Leave empty for full-bay. Formerly set to `"Potomac,Upper Chesapeake,..."`. |
| `CMC_PARAMETERS` | `""` (all) | Leave empty; push client filters client-side by `ParameterCode` prefix. |

### Supabase `ingest-cmc` edge function secrets

| Secret | Notes |
|---|---|
| `SUPABASE_URL` | Auto-injected by Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected. Required to write under RLS. |
| `CRON_SECRET` | Must match the `.env` value on the push machine. |
| `ASSIGN_RADIUS_M` | Optional. Default `1500`. Max site-station assignment radius for backfill. |

---

## CMC API

- **Endpoint:** `POST https://cmc2.vims.edu/DashboardApi/FetchSamplesForDownload`
- **Auth:** None (CORS open)
- **Response:** JSON array, one object per parameter per sample

### Request payload

```json
{
  "dataType": "Water Quality",
  "groups": "",
  "stations": "",
  "states": "",
  "counties": "",
  "watersheds": "",
  "subwatersheds": "",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "parameters": ""
}
```

Leave `watersheds` and `parameters` empty to retrieve the full Chesapeake Bay dataset. Do NOT pass a `states` value (e.g. `"VA"`) — the API returns an empty body for state-string filters.

`cmc-push.mjs` filters client-side, keeping only rows where `ParameterCode` starts with `ECOLI` or `ENT` (enterococci), and skips rows where `ProblemCode` is non-empty.

### Key response fields

| Field | Notes |
|---|---|
| `StationCode` | Short code, e.g. `ARK.AR.2`. Prefix `CHESAPEAKEMONITORINGCOOP-CMC.` to get the WQP station identifier. |
| `GroupCode` | Monitoring organization: `ARK`, `PRK`, `ACB`, `ACBM`, `FMR`, `SHR`, `TWC` |
| `ParameterCode` | Starts with `ECOLI` for E. coli variants; `ENT` for enterococci. |
| `DateTime` | Eastern local time, no timezone marker. |
| `Value` | Bacteria concentration (MPN or CCE per 100 mL). |
| `ProblemCode` | Non-empty = QA flag. Skip these rows. |
| `Lat` / `Long` | Station coordinates. **Field names are `Lat`/`Long`, NOT `Latitude`/`Longitude`.** |

### CMC monitoring groups

| GroupCode | Organization |
|---|---|
| `ARK` | Anacostia Riverkeeper |
| `PRK` | Potomac Riverkeeper |
| `ACB` / `ACBM` | Anacostia Community Boathouse |
| `FMR` | Friends of the Rappahannock |
| `SHR` | Shenandoah Riverkeeper |
| `TWC` | Two Creeks |

---

## EPA Classification

`ingest-cmc` recomputes status server-side and never trusts client-supplied safety values (defense-in-depth for a safety app).

**Freshwater E. coli:**

| Result | Threshold |
|---|---|
| `pass` | E. coli < 235 MPN/100mL |
| `caution` | 235 ≤ E. coli < 410 MPN/100mL |
| `unsafe` | E. coli ≥ 410 MPN/100mL |

**Tidal/marine Enterococci:**

| Result | Threshold |
|---|---|
| `pass` | Enterococci < 35 CCE/100mL |
| `caution` | 35 ≤ Enterococci < 130 CCE/100mL |
| `unsafe` | Enterococci ≥ 130 CCE/100mL |

When both indicators are present in a merged event, `status` is the worst of the two classifications.

Source: EPA 2012 Recreational Water Quality Criteria (RWQC).

---

## Station Matching (4-stage cascade)

`ingest-cmc` loads all `monitoring_stations` rows with `station_code LIKE 'CHESAPEAKEMONITORINGCOOP-CMC.%'` in a single query and performs matching in memory — the incoming code list is never passed into a `.in()` filter (which overflows PostgREST's URL limit on large backfills).

| Stage | Method |
|---|---|
| **1 — EXACT** | Strip prefix from DB codes; compare to incoming code exactly |
| **2 — NORMALIZED** | Replace hyphens→dots, uppercase both sides; matches `PRK.PR-10` → `PRK.PR.10` |
| **3 — COORDINATE** | Load all stations with coordinates; find nearest within 100 m of sample lat/lng |
| **4 — CREATE** | Create new `monitoring_stations` row using sample coordinates |

After matching, any resolved station with no `site_station_assignments` rows gets assignments created for active sites within `ASSIGN_RADIUS_M` (default 1500 m).

**Event merging:** Multiple samples from the same station + `sampledAt` (e.g. E. coli and Enterococci) are merged into a single `readings` row carrying both `e_coli_mpn` and `enterococci_cce`. The upsert key is `(site_id, sampled_at, data_source)`, so this prevents duplicate rows that would previously have caused one indicator to be silently dropped.

---

## Running Manually

### Daily push (from `cmc_to_sql/` directory)

```powershell
cd cmc_to_sql
node --env-file=.env cmc-push.mjs
```

### Historical backfill (all data back to ~2018)

```powershell
cd cmc_to_sql
$env:CMC_LOOKBACK_DAYS = "3000"
node --env-file=.env cmc-push.mjs
```

The backfill sends ~4.7k samples in batches of 500. Each batch triggers the full 4-stage matching cascade in the edge function. Expect 10–20 minutes total.

### Smoke-test `ingest-cmc` with an empty payload

```powershell
Invoke-WebRequest -Method POST `
  -Uri "https://nchorqfnmbngewnhgcvh.supabase.co/functions/v1/ingest-cmc" `
  -Headers @{
    "Content-Type" = "application/json"
    "x-cron-secret" = "<CRON_SECRET>"
  } `
  -Body '{"samples":[]}'
```

Expected response: `{"received":0,"inserted":0,...,"errors":[]}`

### Reading the summary JSON

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

`skipped_no_site` after a successful 4-stage match means those stations are > 1500 m from any active paddle site. This is expected for remote CMC stations.

---

## Windows Task Scheduler Setup

The `--env-file=.env` flag loads secrets from `cmc_to_sql/.env`. The "Start in" directory must be `cmc_to_sql\` so `.env` resolves.

1. **Task Scheduler** → Create Task
2. **General:** Name = `WaterVoice CMC Push`; run whether logged in; run with highest privileges
3. **Triggers:** Daily at 07:00 AM
4. **Actions:**
   - Program: full path to `node.exe` (e.g. `C:\Program Files\nodejs\node.exe`)
   - Arguments: `--env-file=.env cmc-push.mjs`
   - Start in: full path to `cmc_to_sql\` (e.g. `C:\path\to\dc-water-watch\cmc_to_sql`)
5. **Conditions:** Uncheck "Start only if on AC power" for a laptop
6. **Settings:** Check "Run task as soon as possible after a scheduled start is missed"

### PowerShell registration

```powershell
$action = New-ScheduledTaskAction `
  -Execute "C:\Program Files\nodejs\node.exe" `
  -Argument "--env-file=.env cmc-push.mjs" `
  -WorkingDirectory "C:\path\to\dc-water-watch\cmc_to_sql"

$trigger  = New-ScheduledTaskTrigger -Daily -At "07:00AM"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable

Register-ScheduledTask `
  -TaskName "WaterVoice CMC Push" `
  -Action   $action `
  -Trigger  $trigger `
  -Settings $settings `
  -RunLevel Highest `
  -Force
```

### Verify last run

```powershell
Get-ScheduledTask -TaskName "WaterVoice CMC Push" |
  Get-ScheduledTaskInfo |
  Select-Object LastRunTime, LastTaskResult, NextRunTime
# LastTaskResult: 0 = success, 267011 = never run
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `ECONNRESET` from CMC | Running from datacenter or VPN exit node | Must run from residential IP. Disable VPN or switch connection. |
| `ingest-cmc HTTP 401` | `CRON_SECRET` mismatch | Check `.env` on local machine vs. Supabase vault value for `CRON_SECRET`. |
| `stations_created: N, skipped_no_site: N` | New stations too far from any paddle site | Expected for remote stations. Widen `ASSIGN_RADIUS_M` only if you know those stations have nearby sites. |
| All `skipped_no_station` | Stage 1–4 all failing | Check that `cmc_to_sql/cmc-push.mjs` is sending `latitude`/`longitude` fields. Coordinates are required for stages 3 and 4. |
| Task Scheduler fires but nothing happens | `node.exe` not found | Use the full absolute path in the action. `Get-Command node` shows the path. |
| `CMC_LOOKBACK_DAYS=3000` node --env-file hangs | Edge function wall-clock exceeded | Reduce `CMC_PUSH_BATCH` to 200 or split the backfill into year-range chunks. |

---

## Portability Note

`ingest-cmc` is written to be portable to AWS Lambda + API Gateway. Only the outer wrapper changes (`Deno.serve` → Lambda handler; `@supabase/supabase-js` → direct `pg`). The auth model (`x-cron-secret` header), station-matching cascade, EPA classification, and upsert contract stay identical. The residential fetch (`cmc-push.mjs`) stays on a non-datacenter host until VIMS allowlists an egress IP or provides an official API.
