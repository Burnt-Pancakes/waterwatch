ALTER TABLE public.ingest_runs
  ADD COLUMN IF NOT EXISTS function_name text;

UPDATE public.ingest_runs SET function_name = 'fetch-water-quality' WHERE function_name IS NULL;

ALTER TABLE public.ingest_runs ALTER COLUMN function_name SET DEFAULT 'fetch-water-quality';
ALTER TABLE public.ingest_runs ALTER COLUMN function_name SET NOT NULL;

SELECT cron.schedule(
  'fetch-water-conditions-hourly',
  '5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://nchorqfnmbngewnhgcvh.supabase.co/functions/v1/fetch-water-conditions',
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

SELECT cron.schedule(
  'prune-water-temp-observations-daily',
  '20 3 * * *',
  $$
  DELETE FROM public.water_temp_observations
  WHERE observed_at < now() - interval '90 days';
  $$
);