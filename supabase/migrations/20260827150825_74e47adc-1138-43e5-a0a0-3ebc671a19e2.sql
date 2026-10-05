CREATE TABLE public.water_temp_observations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source text NOT NULL,
  station_code text NOT NULL,
  station_name text,
  time_series_id text,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  observed_at timestamptz NOT NULL,
  depth_m numeric,
  temp_c numeric NOT NULL,
  qa text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, station_code, observed_at)
);

GRANT SELECT ON public.water_temp_observations TO anon, authenticated;
GRANT ALL ON public.water_temp_observations TO service_role;

ALTER TABLE public.water_temp_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Water temp observations are publicly readable"
  ON public.water_temp_observations
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE INDEX water_temp_observations_observed_at_idx
  ON public.water_temp_observations (observed_at DESC);

CREATE INDEX water_temp_observations_station_idx
  ON public.water_temp_observations (source, station_code, observed_at DESC);