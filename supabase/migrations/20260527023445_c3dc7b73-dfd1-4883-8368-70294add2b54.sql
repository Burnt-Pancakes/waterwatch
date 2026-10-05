
-- Enable required extensions.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create (or upsert) the vault entry the cron jobs read from.
-- Use a placeholder; the operator will update it to match CRON_SECRET below.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_secret') THEN
    PERFORM vault.create_secret('CHANGE_ME', 'cron_secret', 'Shared bearer token for /api/public/ingest');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'ingest_url') THEN
    PERFORM vault.create_secret(
      'https://project--29b73689-ffd3-4244-8dc7-8cba22d39c96.lovable.app/api/public/ingest',
      'ingest_url',
      'Stable public URL for the ingest endpoint'
    );
  END IF;
END $$;

-- Helper that resolves the latest plaintext value for a vault secret by name.
CREATE OR REPLACE FUNCTION public._get_vault_secret(p_name text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = vault, public
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = p_name
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public._get_vault_secret(text) FROM PUBLIC, anon, authenticated;

-- Unschedule any prior versions so this migration is rerunnable.
DO $$
DECLARE
  j text;
BEGIN
  FOR j IN SELECT jobname FROM cron.job WHERE jobname IN ('ingest-all','ingest-noaa','ingest-osm') LOOP
    PERFORM cron.unschedule(j);
  END LOOP;
END $$;

-- 1) Daily 6 AM UTC — run every adapter.
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

-- 2) Every 6 hours — NOAA rain only.
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

-- 3) Weekly Monday 4 AM UTC — OSM POIs only.
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
