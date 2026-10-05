
-- Drop scheduled jobs that depend on pg_cron before relocating it.
DO $$
DECLARE j text;
BEGIN
  FOR j IN SELECT jobname FROM cron.job WHERE jobname IN ('ingest-all','ingest-noaa','ingest-osm') LOOP
    PERFORM cron.unschedule(j);
  END LOOP;
END $$;

DROP EXTENSION IF EXISTS pg_cron;
DROP EXTENSION IF EXISTS pg_net;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Recreate the three jobs.
SELECT cron.schedule(
  'ingest-all',
  '0 6 * * *',
  $cron$
  SELECT net.http_post(
    url := public._get_vault_secret('ingest_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || public._get_vault_secret('cron_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
SELECT cron.schedule(
  'ingest-noaa',
  '0 */6 * * *',
  $cron$
  SELECT net.http_post(
    url := public._get_vault_secret('ingest_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || public._get_vault_secret('cron_secret')
    ),
    body := '{"sourceId":"noaa_rain"}'::jsonb
  );
  $cron$
);
SELECT cron.schedule(
  'ingest-osm',
  '0 4 * * 1',
  $cron$
  SELECT net.http_post(
    url := public._get_vault_secret('ingest_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || public._get_vault_secret('cron_secret')
    ),
    body := '{"sourceId":"osm_poi"}'::jsonb
  );
  $cron$
);
