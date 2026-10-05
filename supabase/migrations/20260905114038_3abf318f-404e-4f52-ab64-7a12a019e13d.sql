SELECT cron.unschedule('fetch-water-quality-daily');
SELECT cron.schedule(
  'fetch-water-quality-daily',
  '0 10 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://nchorqfnmbngewnhgcvh.supabase.co/functions/v1/fetch-water-quality',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', public._get_vault_secret('cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 400000
  );
  $cron$
);