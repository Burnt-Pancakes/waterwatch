# Operations Runbook

Day-to-day tasks, manual triggers, health checks, and known constraints.

---

## Edge Function Deploys

**Edge functions do NOT deploy from GitHub.** The files in `supabase/functions/` are reference copies only. Canonical versions live in Lovable's Supabase dashboard.

To update an edge function:
1. Open Lovable → Supabase dashboard → Edge Functions
2. Select the function and edit in the dashboard, **or**
3. Ask Lovable via chat to update it (more reliable for logic changes)

Pushing a change to `supabase/functions/` on GitHub does nothing to production.

---

## Manual Triggers

### Trigger `fetch-water-conditions` via PowerShell (from residential or any machine)

```powershell
$secret = "YOUR_CRON_SECRET"
$uri    = "https://nchorqfnmbngewnhgcvh.supabase.co/functions/v1/fetch-water-conditions"

Invoke-RestMethod -Method POST -Uri $uri `
  -Headers @{
    "Content-Type"  = "application/json"
    "x-cron-secret" = $secret
  } `
  -Body '{}'
```

Response includes `rows_upserted`, `usgs_stations`, `cbibs_stations`, `errors`. CBIBS errors are expected from cloud IPs; USGS errors are not.

### Trigger `fetch-water-quality` via SQL

Run from Supabase SQL editor (requires `pg_net` extension):

```sql
SELECT net.http_post(
  url     := 'https://nchorqfnmbngewnhgcvh.supabase.co/functions/v1/fetch-water-quality',
  headers := jsonb_build_object(
    'Content-Type',  'application/json',
    'x-cron-secret', public._get_vault_secret('cron_secret')
  ),
  body    := '{}'::jsonb
);
```

### Trigger `ingest-all` (PATH A TanStack adapters) via SQL

```sql
SELECT net.http_post(
  url     := current_setting('app.ingest_url'),
  headers := jsonb_build_object(
    'Content-Type',  'application/json',
    'Authorization', 'Bearer ' || current_setting('app.service_role_key')
  ),
  body    := '{}'::jsonb
);
```

> **Note:** `ingest-all` calls the Lovable preview server URL stored in the `ingest_url` vault secret. If that server is cold or unreachable, this call fails silently. `fetch-water-quality` uses a direct edge-function URL and is unaffected.

### Trigger `fetch-water-quality` via PowerShell (from residential machine)

```powershell
$secret = "YOUR_CRON_SECRET"
$uri    = "https://nchorqfnmbngewnhgcvh.supabase.co/functions/v1/fetch-water-quality"

Invoke-RestMethod -Method POST -Uri $uri `
  -Headers @{
    "Content-Type"  = "application/json"
    "x-cron-secret" = $secret
  } `
  -Body '{}'
```

### Trigger `ingest-cmc` via PowerShell (smoke test with empty payload)

```powershell
$secret = "YOUR_CRON_SECRET"
$uri    = "https://nchorqfnmbngewnhgcvh.supabase.co/functions/v1/ingest-cmc"

Invoke-RestMethod -Method POST -Uri $uri `
  -Headers @{
    "Content-Type"  = "application/json"
    "x-cron-secret" = $secret
  } `
  -Body '{"samples":[]}'
```

Expected: `{"received":0,"inserted":0,...,"errors":[]}`

### CMC full push (from `cmc_to_sql/` on residential machine)

```powershell
cd cmc_to_sql
node --env-file=.env cmc-push.mjs
```

See [docs/ingestion-cmc.md](ingestion-cmc.md) for the full CMC runbook including historical backfill, Task Scheduler setup, and troubleshooting.

---

## Verifying a Run

### Checking `fetch-water-quality` results

After triggering, query the `readings` table for recent inserts:

```sql
SELECT data_source, sampled_at::date, COUNT(*) AS n
FROM readings
WHERE created_at > now() - interval '2 hours'
GROUP BY 1, 2
ORDER BY 2 DESC;
```

### Checking CMC push results

The edge function response body is the summary JSON:

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

A non-zero `skipped_no_site` after a full cascade is expected — those stations are > 1500 m from any paddle site.

### Checking pg_cron health

```sql
SELECT jobname, schedule, active, last_run_time, last_run_details
FROM cron.job_run_details
ORDER BY last_run_time DESC
LIMIT 20;
```

### Checking Task Scheduler health (CMC push on Windows)

```powershell
Get-ScheduledTask -TaskName "WaterVoice CMC Push" |
  Get-ScheduledTaskInfo |
  Select-Object LastRunTime, LastTaskResult, NextRunTime
# LastTaskResult: 0 = success, 267011 = never run
```

---

## pg_cron Registration

Cron jobs are registered in Supabase migrations. To register a new job or fix a broken URL:

```sql
DO $$
BEGIN
  PERFORM cron.unschedule('job-name') 
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'job-name');
  
  PERFORM cron.schedule(
    'job-name',
    '0 10 * * *',
    $cron$
    SELECT net.http_post(
      url     := 'https://nchorqfnmbngewnhgcvh.supabase.co/functions/v1/function-name',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', public._get_vault_secret('cron_secret')
      ),
      body    := '{}'::jsonb
    );
    $cron$
  );
END;
$$;
```

The `DO $$` block makes it safely rerunnable. Create a migration file in `supabase/migrations/` with the timestamp prefix — do NOT run this ad-hoc against prod without a migration file backing it.

Current pg_cron schedule:

| Job name | Schedule | Target |
|---|---|---|
| `ingest-all` | `0 6 * * *` | PATH A TanStack adapters |
| `ingest-noaa` | `0 */6 * * *` | `?source=noaa` |
| `ingest-osm` | `0 4 * * 1` | `?source=osm` |
| `fetch-gauge-readings` | `*/15 * * * *` | Gauge edge function |
| `fetch-tidal-predictions` | `0 */6 * * *` | Tidal predictions edge function |
| `fetch-weather` | `0 * * * *` | Weather edge function |
| `fetch-water-quality-daily` | `0 10 * * *` | WQP edge function (`timeout_milliseconds: 400000`) |
| `fetch-water-conditions-hourly` | `5 * * * *` | Water temperature edge function (USGS + CBIBS) |
| `prune-water-temp-observations-daily` | `20 3 * * *` | SQL: `DELETE FROM water_temp_observations WHERE observed_at < now() - interval '90 days'` |

`ingest-cmc` has no pg_cron entry — triggered by `cmc-push.mjs` via Windows Task Scheduler.

---

## Package-Lock Sync

Lovable sometimes bumps package versions without updating `package-lock.json` in sync with the local repo. After a Lovable session that adds or changes packages:

```bash
git pull origin main
npm ci
```

If `npm ci` fails due to lock file mismatch, run `npm install` to regenerate, then commit the updated `package-lock.json`:

```bash
npm install
git add package-lock.json
git commit -m "Sync package-lock.json after Lovable dependency update"
```

Do not commit `node_modules/`.

---

## Known Constraints & Gotchas

### CMC residential-IP constraint

`cmc2.vims.edu` (Microsoft-IIS) resets TCP connections from AWS, GCP, and Supabase IP ranges. This is not a transient error — it is a server-level block on cloud egress IPs. `cmc-push.mjs` must run from a residential IP (home machine, phone hotspot). A VPN exit node counts as a datacenter IP and is also blocked.

The `ingest-cmc` edge function itself is portable — only the outer fetch wrapper (`cmc-push.mjs`) needs to move. `fetch-water-quality` also has a cloud-path CMC attempt via `cmc-adapter.ts` as SOURCE 2, but it fails in practice for the same reason.

### Lovable does NOT pull from GitHub

Lovable has its own copy of the code. Features built in Claude Code must be delivered as Lovable chat prompts. Code pushed to GitHub does not appear in Lovable's editor or deploy pipeline. Edge function reference copies in `supabase/functions/` are for local context only — the production version is in the Lovable Supabase dashboard.

### `ingest-all` targets the Lovable preview URL

The `ingest-all`, `ingest-noaa`, and `ingest-osm` pg_cron jobs call the Lovable preview server URL (stored in the `ingest_url` vault secret), not the stable production Vercel URL. If Lovable's preview server is cold or unreachable, these jobs fail silently — no error surfaced in `cron.job_run_details`, just a failed HTTP call. `fetch-water-quality` is immune to this because its pg_cron job targets the edge function's stable URL directly.

### `waterQualityEngine.ts` enterococci thresholds vs. `fetch-water-quality`

`fetch-water-quality/index.ts` uses tidal enterococci thresholds of 70 (caution) / 104 (unsafe). `waterQualityEngine.ts` and `ingest-cmc/index.ts` use 35 (caution) / 130 (unsafe). These represent different statistical bases: 70/104 are the EPA Beach Action Value (BAV) and marine STV; 35/130 are the RWQC geometric-mean criterion and STV. The discrepancy means a tidal-site reading from `fetch-water-quality` may display a different status than the same reading processed by `waterQualityEngine.ts`. Reconcile before adding more tidal sites.

### SSR browser guards

TanStack Start server-renders every page. `window`, `localStorage`, `navigator`, `matchMedia`, and MapLibre GL JS all access browser globals at module evaluation time. Any of these in a top-level import or component body will crash the SSR pass. Guard with `useEffect` or `typeof window !== 'undefined'`. MapLibre is imported dynamically inside `useEffect` in `WaterVoiceMap.tsx` for this reason.

### Service role key must never reach the client bundle

`src/integrations/supabase/client.server.ts` is named with the `.server.ts` suffix, which Vite recognizes and strips from the client bundle. Never import the service-role client in a non-`.server.ts` file. For tables not in generated types, use `supabase as unknown as SupabaseClient`, never `supabase as any`.

### RLS on every table

All tables have Row-Level Security enabled. Never bypass RLS from client code. The service-role key is used only in server functions (`createServerFn`) and edge functions — never on the client. The map and water quality data are fully public; auth gates only favorites, alerts, and account management.

### Never `git reset --hard` without confirming

This has destroyed work in the past. If local changes conflict with remote, investigate first. Prefer `git stash` or `git diff` to understand the conflict before taking any destructive action.

---

## Activating the AI Explanation Feature

The "Explain this reading" button in the Site Bottom Sheet is fully built but gated behind an `ANTHROPIC_API_KEY` environment variable.

To activate it:
1. Lovable → Project Settings → Secrets
2. Add secret: `ANTHROPIC_API_KEY` = your Anthropic API key
3. No code change or redeploy needed — the key is read at request time by `src/routes/api/explain.ts`

The button renders regardless of whether the key is set. Without the key, clicking it returns an error response.
