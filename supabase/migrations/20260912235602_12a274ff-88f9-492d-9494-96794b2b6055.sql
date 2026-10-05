-- Change retention windows for pruning cron jobs and stagger their schedules
--
-- 1. prune-gauge-readings-daily: retain 8 days instead of 2 days
-- 2. prune-water-temp-observations-daily: retain 2 days instead of 90 days,
--    and run at 03:25 UTC instead of 03:20 UTC so it does not collide with job 14

-- Update prune-gauge-readings-daily (jobid 14): 8-day retention
SELECT cron.unschedule('prune-gauge-readings-daily');
SELECT cron.schedule(
  'prune-gauge-readings-daily',
  '20 3 * * *',
  $$
    DELETE FROM public.gauge_readings
    WHERE recorded_at < now() - interval '8 days';
  $$
);

-- Update prune-water-temp-observations-daily (jobid 10): 2-day retention, 03:25 UTC
SELECT cron.unschedule('prune-water-temp-observations-daily');
SELECT cron.schedule(
  'prune-water-temp-observations-daily',
  '25 3 * * *',
  $$
    DELETE FROM public.water_temp_observations
    WHERE observed_at < now() - interval '2 days';
  $$
);
