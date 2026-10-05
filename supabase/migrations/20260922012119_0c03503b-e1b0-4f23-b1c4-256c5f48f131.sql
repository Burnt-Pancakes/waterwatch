-- Schedule fetch-sea-nettles hourly at :45, mirroring fetch-rainfall-hourly (job 17).
-- Unschedule first so re-runs are idempotent.
select cron.unschedule('fetch-sea-nettles-hourly')
where exists (select 1 from cron.job where jobname = 'fetch-sea-nettles-hourly');

select cron.schedule(
  'fetch-sea-nettles-hourly',
  '45 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://nchorqfnmbngewnhgcvh.supabase.co/functions/v1/fetch-sea-nettles',
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