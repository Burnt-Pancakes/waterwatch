-- Sea nettle (jellyfish) observation layer + daily retention job
--
-- Additive only: creates public.nettle_observations and registers the
-- prune-nettle-observations-daily cron job. No foreign keys to any existing
-- table, and no alterations to any existing table.
--
-- Access model: anyone (anon or signed-in) may READ observations; there is no
-- public write path. Rows are written only by the ingest layer, which uses the
-- service-role key, and are retained for 2 days.

CREATE TABLE IF NOT EXISTS public.nettle_observations (
  id             uuid primary key default gen_random_uuid(),
  station_code   text not null,
  station_name   text,
  lat            double precision not null,
  lng            double precision not null,
  observed_at    timestamptz not null,
  probability    numeric not null,
  water_temp_c   numeric,
  salinity_psu   numeric,
  source         text not null default 'CBIBS',
  created_at     timestamptz not null default now(),
  -- One row per station per sample time: the ingest upserts on this key.
  CONSTRAINT nettle_observations_station_time_key
    UNIQUE (station_code, observed_at),
  -- probability is a percentage forecast value (0-100).
  CONSTRAINT nettle_observations_probability_range
    CHECK (probability >= 0 AND probability <= 100)
);

-- Support the retention delete and "latest sample per station" reads; the
-- unique constraint above is keyed on station_code first, so it cannot serve
-- a time-ordered scan on its own.
CREATE INDEX IF NOT EXISTS idx_nettle_observations_observed_at
  ON public.nettle_observations (observed_at DESC);

-- Grants must accompany the table: the Data API does not hold default
-- privileges on the public schema, so SELECT here is what makes the public
-- read policy usable at all. Writes stay service-role only.
GRANT SELECT ON public.nettle_observations TO anon, authenticated;
GRANT ALL   ON public.nettle_observations TO service_role;

ALTER TABLE public.nettle_observations ENABLE ROW LEVEL SECURITY;

-- Public read only. No INSERT/UPDATE/DELETE policy exists, so anon and
-- authenticated clients cannot write through the Data API.
DROP POLICY IF EXISTS "Nettle observations are publicly readable"
  ON public.nettle_observations;
CREATE POLICY "Nettle observations are publicly readable"
  ON public.nettle_observations FOR SELECT
  TO anon, authenticated
  USING (true);

-- Daily retention: keep 2 days of observations, at 03:30 UTC (staggered past
-- the 03:20 gauge prune and the 03:25 water-temp prune).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'prune-nettle-observations-daily'
  ) THEN
    PERFORM cron.unschedule('prune-nettle-observations-daily');
  END IF;
END
$$;

SELECT cron.schedule(
  'prune-nettle-observations-daily',
  '30 3 * * *',
  $$
    DELETE FROM public.nettle_observations
    WHERE observed_at < now() - interval '2 days';
  $$
);
