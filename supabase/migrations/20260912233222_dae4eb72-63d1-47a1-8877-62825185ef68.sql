DO $do$
BEGIN
  PERFORM cron.unschedule('prune-gauge-readings-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-gauge-readings-daily');

  PERFORM cron.schedule(
    'prune-gauge-readings-daily',
    '20 3 * * *',
    $$
    DELETE FROM public.gauge_readings
    WHERE recorded_at < now() - interval '2 days';
    $$
  );
END;
$do$;