-- Register the fetch-rainfall cron job.
--
-- Measured rainfall for the DMV rain advisory (KDCA/KBWI/KDULLES averages,
-- see supabase/functions/fetch-rainfall/index.ts). Shape matches the
-- fetch-water-conditions-hourly registration in 20260828031318 exactly:
-- net.http_post with the same three-header jsonb_build_object (Content-Type,
-- Authorization: Bearer <publishable key> for the gateway, x-cron-secret via
-- vault for the function's own check), body '{}'::jsonb, explicit
-- timeout_milliseconds.
--
-- timeout_milliseconds: 120000, matching fetch-water-conditions-hourly (job 9)
-- deliberately, not copied blindly - this job has the same shape as job 9
-- (hourly cadence, a handful of quick external API calls, no per-item retry
-- loop, no tile grid), unlike fetch-gauge-readings-15min, where job 9's
-- 120000 was wrong specifically because of its 15-minute cadence. fetch-rainfall
-- makes 3 concurrent NWS station-observation fetches with no backoff; expected
-- runtime is low single-digit seconds. 120000 is headroom, not a measured need.
--
-- First registration of this job - no prior schedule to unschedule.

SELECT cron.schedule(
  'fetch-rainfall-hourly',
  '35 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://nchorqfnmbngewnhgcvh.supabase.co/functions/v1/fetch-rainfall',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_h7e4vKV6hb-F4d6i0b36DQ_aokEODTD',
      'x-cron-secret', public._get_vault_secret('cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
