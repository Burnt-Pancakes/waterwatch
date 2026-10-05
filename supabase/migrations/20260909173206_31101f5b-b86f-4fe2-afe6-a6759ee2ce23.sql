-- ============================================================================
-- Bacteria ingest has been broken since 2026-09-04.
--
-- ROOT CAUSE. The cron job `fetch-water-quality-daily` (pg_cron job 11) was
-- deleted and recreated on 2026-09-06 (jobids 7 and 8 no longer exist;
-- cron.job_run_details for job 11 starts Sep 6), and the recreation dropped the
-- Authorization header. Compare against the working `fetch-water-conditions-
-- hourly` (job 9, migration 20260828031318):
--
--   job 9  headers: Content-Type + Authorization: Bearer <publishable key>
--                   + x-cron-secret
--   job 11 headers: Content-Type + x-cron-secret        <-- no Authorization
--
-- The Supabase functions gateway rejects the dispatch before the function runs
-- when the Authorization header is absent (net._http_response shows 500s for
-- those dispatches; all four job 11 runs report "succeeded" in ~0.06s, which is
-- pg_net accepting the POST, not the 2-4 minute function executing). ingest_runs
-- has no fetch-water-quality completion since 2026-09-04 10:04.
--
-- fetch-water-quality/index.ts authorizes on
-- `Authorization === "Bearer <SERVICE_ROLE_KEY>"` OR `x-cron-secret === CRON_SECRET`.
-- The publishable key in the Authorization header is NOT what the function
-- checks - it is what the gateway needs to route the request. x-cron-secret
-- (from vault) remains the function-level auth. This migration restores job 11
-- to job 9's exact header shape.
--
-- NOTE ON THE PUBLISHABLE KEY. `sb_publishable_...` is the project's anon /
-- publishable key - public by design, already shipped in the client bundle and
-- already present in cron job definitions in this repo (20260828031318 and the
-- existing job 4 command). This migration matches that existing practice; it
-- does not introduce the key. Whether storing it in cron.job definitions is
-- worth revisiting is a separate discussion, not changed here.
--
-- This migration touches ONLY cron jobs 11 and 4. It does not apply itself and
-- must not be handed to Lovable as a bare instruction - it is the migration file.
-- ============================================================================


-- ── TASK 1 ──────────────────────────────────────────────────────────────────
-- Restore the Authorization header on fetch-water-quality-daily.
-- Unschedule by jobname (survives another delete/recreate), guarded so this
-- migration is safe to re-run. Schedule and timeout are unchanged from the
-- broken job: '0 10 * * *', 400000 ms.

DO $$
DECLARE
  j text;
BEGIN
  FOR j IN SELECT jobname FROM cron.job WHERE jobname = 'fetch-water-quality-daily'
  LOOP
    PERFORM cron.unschedule(j);
  END LOOP;
END $$;

SELECT cron.schedule(
  'fetch-water-quality-daily',
  '0 10 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://nchorqfnmbngewnhgcvh.supabase.co/functions/v1/fetch-water-quality',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_h7e4vKV6hb-F4d6i0b36DQ_aokEODTD',
      'x-cron-secret', public._get_vault_secret('cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 400000
  );
  $cron$
);


-- ── TASK 2 ──────────────────────────────────────────────────────────────────
-- Observability only. fetch-gauge-readings-15min (job 4) sets no
-- timeout_milliseconds, so pg_net applies its 5000 ms default and logs
-- "Timeout of 5000 ms reached" in net._http_response on every dispatch.
--
-- The job is NOT broken: gauge_readings received 31,559 rows in the last 24 h,
-- newest 2026-09-09 16:20. The function completes and writes; pg_net just stops
-- waiting for the response. An explicit timeout makes pg_net wait for the real
-- response so the log stops recording failures that did not happen.
--
-- Timeout value: 30000 ms, sized from what the function does, NOT copied from
-- job 9. fetch-gauge-readings/index.ts queries river_gauges (~171 non-NOAA
-- rows) then fans out with Promise.all - all gauges run concurrently, one USGS
-- Instantaneous-Values fetch each (single site, 24 h, params 00065/00060) plus
-- a small gauge_readings upsert (~2 rows/gauge/run). No sequential work, no
-- large writes; wall time is the slowest fetch plus connection queueing, i.e.
-- seconds, not minutes. 30 s is generous headroom over that. It is NOT sized
-- like job 9's 120 s: job 9 runs hourly so a 2-minute hang clears before the
-- next fire, but job 4 runs every 15 minutes and a hung dispatch holding the
-- connection for 2 minutes while the next dispatch arrives is a real hazard.
-- If measured runtime ever approaches 30 s, raise it - this is a log-noise
-- fix, not a behaviour change.
--
-- fetch-gauge-readings/index.ts has NO shared-secret check (it is explicitly
-- flagged "unauthenticated edge function" with a TODO). x-cron-secret is
-- therefore NOT added here - the function does not read it, and changing the
-- auth shape of a working job is out of scope. The raw-jsonb-string header and
-- the absence of x-cron-secret are preserved exactly; only timeout_milliseconds
-- is added.
--
-- The live schedule is read from cron.job and reused verbatim so the cadence is
-- not touched even if the stored expression differs from '*/15 * * * *'.
--
-- The command block below is job 4's definition as of 2026-09-09 (plus the
-- timeout). This DO block overwrites the command wholesale: re-running this
-- migration against a database where job 4 has since been changed by other
-- means would replace that change with this version.

DO $$
DECLARE
  v_schedule text;
BEGIN
  SELECT schedule INTO v_schedule
  FROM cron.job
  WHERE jobname = 'fetch-gauge-readings-15min';

  IF v_schedule IS NULL THEN
    RAISE NOTICE 'cron job fetch-gauge-readings-15min not found; skipping timeout update';
    RETURN;
  END IF;

  PERFORM cron.unschedule('fetch-gauge-readings-15min');

  PERFORM cron.schedule(
    'fetch-gauge-readings-15min',
    v_schedule,
    $cmd$
  select net.http_post(
    url := 'https://nchorqfnmbngewnhgcvh.supabase.co/functions/v1/fetch-gauge-readings',
    headers := '{"Authorization": "Bearer sb_publishable_h7e4vKV6hb-F4d6i0b36DQ_aokEODTD", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cmd$
  );
END $$;