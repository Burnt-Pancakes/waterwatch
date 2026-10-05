-- Register the weekly focus-group feedback email cron job.
--
-- Posts to the STABLE project URL (not the Lovable preview URL — per the note
-- in docs/EDGE_FUNCTIONS.md, preview-URL cron jobs silently fail when the
-- preview server is cold). This report would normally be a Supabase edge
-- function; creating new edge functions is blocked in this project, so it is
-- implemented as the public server route /api/public/send-weekly-feedback,
-- which performs the same x-cron-secret shared-secret check.
--
-- SCHEDULE NOTE: '0 13 * * 1' is Monday 13:00 UTC = 9:00am ET during US
-- daylight time. US daylight time ends Sunday November 1, 2026; after that
-- date 9:00am ET is 14:00 UTC, so to keep the send at 9am ET the expression
-- must be changed to '0 14 * * 1' at that point. Deliberately left at
-- '0 13 * * 1' for now — this is a note, not an auto-adjustment.

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'waterwatch-weekly-feedback') THEN
    PERFORM cron.unschedule('waterwatch-weekly-feedback');
  END IF;
END
$do$;

SELECT cron.schedule(
  'waterwatch-weekly-feedback',
  '0 13 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://project--29b73689-ffd3-4244-8dc7-8cba22d39c96.lovable.app/api/public/send-weekly-feedback',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', public._get_vault_secret('cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);