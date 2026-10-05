-- ============================================================================
-- EDITED 2026-09-08, after this migration was already applied to production
-- (supabase_migrations.schema_migrations version 20260603032545). Production
-- will NOT re-run it.
--
-- The public.gauge_readings CREATE TABLE block below was rewritten from its
-- literal 2026-06-03 shape to the schema Lovable evolved the table to during
-- the June-August 2026 migration gap, so that a fresh `supabase db reset`
-- reproduces the live schema directly instead of the obsolete one.
--
-- Original block, as actually applied on 2026-06-03 (see git history):
--   gauge_id uuid NOT NULL REFERENCES river_gauges(id) ON DELETE CASCADE,
--   gage_height_ft float8, discharge_cfs float8,
--   data_source text DEFAULT 'usgs_iv',
--   UNIQUE (gauge_id, recorded_at)
--   CREATE INDEX gauge_readings_gauge_time ON gauge_readings (gauge_id, recorded_at DESC);
--
-- Live shape (verified against information_schema / pg_constraint 2026-09-08):
--   gauge_id renamed to station_id; gage_height_ft/discharge_cfs/data_source
--   dropped; stage_ft/flow_cfs/trend/qualifier/raw_json added; FK renamed to
--   fk_gauge_readings_station; unique constraint renamed; trend CHECK added;
--   index renamed to idx_gauge_readings_station_time.
--
-- public.river_gauges and the seed INSERT are unchanged from the original.
-- This file now documents INTENDED current state, not literal history. The
-- "Public read" policy created on gauge_readings below is reconciled away by
-- 20260909000000_reconcile_live_schema.sql (live keeps only the
-- "Gauge readings are publicly readable" policy from 20260606105601).
-- ============================================================================

CREATE TABLE public.river_gauges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  usgs_site_number text NOT NULL UNIQUE,
  name text NOT NULL,
  lat float8 NOT NULL,
  lng float8 NOT NULL,
  state_code text,
  county text,
  drainage_area_sq_mi float8,
  created_at timestamptz DEFAULT now()
);

GRANT SELECT ON public.river_gauges TO anon, authenticated;
GRANT ALL ON public.river_gauges TO service_role;

ALTER TABLE public.river_gauges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON public.river_gauges FOR SELECT USING (true);

CREATE TABLE public.gauge_readings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id  uuid NOT NULL,
  recorded_at timestamptz NOT NULL,
  stage_ft    numeric,
  flow_cfs    numeric,
  trend       text,
  qualifier   text,
  raw_json    jsonb,
  created_at  timestamptz DEFAULT now(),
  CONSTRAINT gauge_readings_station_id_recorded_at_key UNIQUE (station_id, recorded_at),
  CONSTRAINT gauge_readings_trend_check
    CHECK (trend = ANY (ARRAY['rising'::text, 'falling'::text, 'steady'::text])),
  CONSTRAINT fk_gauge_readings_station
    FOREIGN KEY (station_id) REFERENCES public.river_gauges(id) ON DELETE CASCADE
);

GRANT SELECT ON public.gauge_readings TO anon, authenticated;
GRANT ALL ON public.gauge_readings TO service_role;

ALTER TABLE public.gauge_readings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON public.gauge_readings FOR SELECT USING (true);

CREATE INDEX idx_gauge_readings_station_time
  ON public.gauge_readings (station_id, recorded_at DESC);

INSERT INTO public.river_gauges (usgs_site_number, name, lat, lng, state_code, county, drainage_area_sq_mi)
VALUES
  ('01652500', 'Four Mile Run at Alexandria, VA', 38.84333, -77.08586, 'VA', 'Arlington County', 12.6),
  ('01646500', 'Potomac River near Washington DC', 38.94972, -77.12778, 'MD', 'Montgomery County', 11560.0),
  ('01649500', 'NE Branch Anacostia River at Riverdale', 38.96139, -76.93167, 'MD', 'Prince Georges County', 72.8);