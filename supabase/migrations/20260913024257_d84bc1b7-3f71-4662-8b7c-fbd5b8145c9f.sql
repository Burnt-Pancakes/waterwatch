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