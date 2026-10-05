-- ============================================================================
-- June-August 2026 gap reconciliation baseline.
--
-- Between schema_migrations versions 20260619112853 and 20260827150825 there
-- are no recorded migrations, but Lovable added ~10 tables/views/functions and
-- altered several existing tables through its own mechanism. This migration
-- captures that live state so a fresh `supabase db reset` reproduces production.
--
-- Every statement is idempotent and non-destructive against an instance that
-- already holds the live schema (this file reaches production through the
-- normal Lovable sync of `main`):
--   * CREATE TABLE / INDEX          -> IF NOT EXISTS
--   * ADD COLUMN                    -> IF NOT EXISTS
--   * ADD CONSTRAINT               -> guarded on pg_constraint
--   * CREATE POLICY                -> preceded by DROP POLICY IF EXISTS
--   * CREATE OR REPLACE FUNCTION / VIEW
--   * ENABLE ROW LEVEL SECURITY / GRANT  -> naturally idempotent
--
-- All DDL below was verified against information_schema / pg_catalog on
-- 2026-09-08. It is the source of truth for the gap period; the repo migration
-- files for June-August were unapplied and are deleted in the same commit.
--
-- Companion edits in this commit:
--   * 20260603032545_ec8d7966...  gauge_readings block rewritten to live shape
--   * 20260606105601_e302d54b...  stage_thresholds grant/RLS/policy lines removed
--   * docs/held-migrations/20260528000001_...  held migration relocated
-- ============================================================================


-- ============================================================================
-- 1. monitoring_stations  (no migration file has ever existed)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.monitoring_stations (
  id                    uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  station_code          text NOT NULL,
  station_name          text NOT NULL,
  agency                text NOT NULL,
  org_identifier        text,
  data_source           text NOT NULL,
  lat                   double precision NOT NULL,
  lng                   double precision NOT NULL,
  state_code            text,
  county                text,
  huc8                  text,
  location_type         text,
  is_tidal              boolean NOT NULL DEFAULT false,
  characteristics       text[] NOT NULL DEFAULT ARRAY['Escherichia coli'::text, 'Enterococci'::text],
  typical_cadence_days  integer,
  last_sample_at        timestamptz,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT monitoring_stations_station_code_key UNIQUE (station_code)
);

CREATE INDEX IF NOT EXISTS idx_mon_stations_active ON public.monitoring_stations (is_active);
CREATE INDEX IF NOT EXISTS idx_mon_stations_agency ON public.monitoring_stations (agency);
CREATE INDEX IF NOT EXISTS idx_mon_stations_coords ON public.monitoring_stations (lat, lng);
CREATE INDEX IF NOT EXISTS idx_mon_stations_state  ON public.monitoring_stations (state_code);

GRANT SELECT ON public.monitoring_stations TO anon, authenticated;
GRANT ALL ON public.monitoring_stations TO service_role;
ALTER TABLE public.monitoring_stations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "monitoring_stations public read" ON public.monitoring_stations;
CREATE POLICY "monitoring_stations public read"
  ON public.monitoring_stations FOR SELECT
  TO anon, authenticated
  USING (true);


-- ============================================================================
-- 2. site_station_assignments  (no migration file has ever existed)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.site_station_assignments (
  id               uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id          uuid NOT NULL,
  station_id       uuid NOT NULL,
  distance_m       double precision,
  assignment_type  text NOT NULL DEFAULT 'nearest'::text,
  priority         integer NOT NULL DEFAULT 1,
  is_primary       boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_station_assignments_site_id_station_id_key UNIQUE (site_id, station_id),
  CONSTRAINT site_station_assignments_site_id_fkey
    FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE,
  CONSTRAINT site_station_assignments_station_id_fkey
    FOREIGN KEY (station_id) REFERENCES public.monitoring_stations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ssa_primary ON public.site_station_assignments (site_id, is_primary);
CREATE INDEX IF NOT EXISTS idx_ssa_site    ON public.site_station_assignments (site_id);

GRANT SELECT ON public.site_station_assignments TO anon, authenticated;
GRANT ALL ON public.site_station_assignments TO service_role;
ALTER TABLE public.site_station_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "site_station_assignments public read" ON public.site_station_assignments;
CREATE POLICY "site_station_assignments public read"
  ON public.site_station_assignments FOR SELECT
  TO anon, authenticated
  USING (true);


-- ============================================================================
-- 3. tidal_predictions  (no migration file; repo file 20260611191534 only
--    contained a data fix, folded in at the end of this migration)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.tidal_predictions (
  id               uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  noaa_station_id  text NOT NULL,
  predicted_at     timestamptz NOT NULL,
  type             text,
  height_ft        numeric,
  fetched_at       timestamptz DEFAULT now(),
  CONSTRAINT tidal_predictions_noaa_station_id_predicted_at_key UNIQUE (noaa_station_id, predicted_at),
  CONSTRAINT tidal_predictions_type_check CHECK (type = ANY (ARRAY['H'::text, 'L'::text]))
);

CREATE INDEX IF NOT EXISTS idx_tidal_predictions_station_time
  ON public.tidal_predictions (noaa_station_id, predicted_at);

GRANT SELECT ON public.tidal_predictions TO anon, authenticated;
GRANT ALL ON public.tidal_predictions TO service_role;
ALTER TABLE public.tidal_predictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read tidal_predictions" ON public.tidal_predictions;
CREATE POLICY "Public read tidal_predictions"
  ON public.tidal_predictions FOR SELECT
  TO anon, authenticated
  USING (true);


-- ============================================================================
-- 4. stage_thresholds  (grant/RLS/policy previously in 20260606105601, which
--    failed on reset because nothing created the table)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.stage_thresholds (
  id              uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  station_id      uuid NOT NULL,
  too_low_ft      numeric DEFAULT 0.5,
  optimal_min_ft  numeric DEFAULT 0.5,
  optimal_max_ft  numeric DEFAULT 2.5,
  caution_max_ft  numeric DEFAULT 4.0,
  notes           text,
  CONSTRAINT stage_thresholds_station_id_key UNIQUE (station_id),
  CONSTRAINT stage_thresholds_station_id_fkey
    FOREIGN KEY (station_id) REFERENCES public.river_gauges(id) ON DELETE CASCADE
);

GRANT SELECT ON public.stage_thresholds TO anon, authenticated;
GRANT ALL ON public.stage_thresholds TO service_role;
ALTER TABLE public.stage_thresholds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Stage thresholds are publicly readable" ON public.stage_thresholds;
CREATE POLICY "Stage thresholds are publicly readable"
  ON public.stage_thresholds FOR SELECT
  TO anon, authenticated
  USING (true);


-- ============================================================================
-- 5. trips + trip_waypoints  (repo file 20260617143000 unapplied; live shapes
--    below differ from it - user_id nullable / no default, policies TO public,
--    FKs nullable)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.trips (
  id                    uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id               uuid,
  name                  text NOT NULL,
  trip_type             text NOT NULL,
  departure_time        timestamptz,
  paddling_speed_knots  numeric DEFAULT 3.0,
  notes                 text,
  is_public             boolean DEFAULT false,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  CONSTRAINT trips_trip_type_check
    CHECK (trip_type = ANY (ARRAY['out_and_back'::text, 'tidal_assist'::text, 'tidal_transit'::text])),
  CONSTRAINT trips_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.trip_waypoints (
  id                     uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  trip_id                uuid,
  order_index            integer NOT NULL,
  waypoint_type          text NOT NULL,
  site_id                uuid,
  custom_name            text,
  lat                    numeric NOT NULL,
  lng                    numeric NOT NULL,
  noaa_station_id        text,
  estimated_arrival_at   timestamptz,
  tide_height_ft         numeric,
  tide_direction         text,
  minutes_to_slack       integer,
  distance_from_prev_nm  numeric,
  travel_time_minutes    integer,
  created_at             timestamptz DEFAULT now(),
  CONSTRAINT trip_waypoints_waypoint_type_check
    CHECK (waypoint_type = ANY (ARRAY['site'::text, 'custom'::text])),
  CONSTRAINT trip_waypoints_trip_id_fkey
    FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE,
  CONSTRAINT trip_waypoints_site_id_fkey
    FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_trip_waypoints_trip_order
  ON public.trip_waypoints (trip_id, order_index);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trips TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_waypoints TO authenticated;
GRANT ALL ON public.trips TO service_role;
GRANT ALL ON public.trip_waypoints TO service_role;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_waypoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own trips" ON public.trips;
CREATE POLICY "Users can manage their own trips"
  ON public.trips FOR ALL
  TO public
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage waypoints of their trips" ON public.trip_waypoints;
CREATE POLICY "Users can manage waypoints of their trips"
  ON public.trip_waypoints FOR ALL
  TO public
  USING (EXISTS (
    SELECT 1 FROM public.trips
    WHERE trips.id = trip_waypoints.trip_id
      AND trips.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.trips
    WHERE trips.id = trip_waypoints.trip_id
      AND trips.user_id = auth.uid()
  ));


-- ============================================================================
-- 6. weather_readings + weather_alerts  (no migration file has ever existed)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.weather_readings (
  id                     uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  station_lat            numeric NOT NULL DEFAULT 38.8951,
  station_lng            numeric NOT NULL DEFAULT '-77.0364'::numeric,
  observed_at            timestamptz NOT NULL,
  wind_speed_mph         numeric,
  wind_direction_deg     integer,
  wind_direction_text    text,
  wind_gust_mph          numeric,
  precip_probability_pct integer,
  precip_last_24h_in     numeric,
  short_forecast         text,
  temperature_f          numeric,
  raw_json               jsonb,
  fetched_at             timestamptz DEFAULT now(),
  CONSTRAINT weather_readings_observed_at_key UNIQUE (observed_at)
);

CREATE INDEX IF NOT EXISTS idx_weather_readings_observed
  ON public.weather_readings (observed_at DESC);

GRANT SELECT ON public.weather_readings TO anon, authenticated;
GRANT ALL ON public.weather_readings TO service_role;
ALTER TABLE public.weather_readings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read weather_readings" ON public.weather_readings;
CREATE POLICY "Public read weather_readings"
  ON public.weather_readings FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE TABLE IF NOT EXISTS public.weather_alerts (
  id            uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nws_alert_id  text NOT NULL,
  event         text NOT NULL,
  severity      text,
  urgency       text,
  headline      text,
  description   text,
  effective_at  timestamptz,
  expires_at    timestamptz,
  area_desc     text,
  lat           numeric,
  lng           numeric,
  raw_json      jsonb,
  fetched_at    timestamptz DEFAULT now(),
  CONSTRAINT weather_alerts_nws_alert_id_key UNIQUE (nws_alert_id)
);

CREATE INDEX IF NOT EXISTS idx_weather_alerts_expires
  ON public.weather_alerts (expires_at DESC);

GRANT SELECT ON public.weather_alerts TO anon, authenticated;
GRANT ALL ON public.weather_alerts TO service_role;
ALTER TABLE public.weather_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read weather_alerts" ON public.weather_alerts;
CREATE POLICY "Public read weather_alerts"
  ON public.weather_alerts FOR SELECT
  TO anon, authenticated
  USING (true);


-- ============================================================================
-- 7. water_quality_advisories  (no migration file has ever existed)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.water_quality_advisories (
  id              uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  site_id         uuid,
  issuing_agency  text NOT NULL,
  advisory_type   text NOT NULL,
  headline        text,
  description     text,
  effective_at    timestamptz NOT NULL,
  expires_at      timestamptz,
  source_url      text,
  is_active       boolean DEFAULT true,
  raw_json        jsonb,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  CONSTRAINT water_quality_advisories_advisory_type_check
    CHECK (advisory_type = ANY (ARRAY['no_swim'::text, 'no_contact'::text, 'caution'::text, 'all_clear'::text])),
  CONSTRAINT water_quality_advisories_site_id_fkey
    FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wqa_site_active
  ON public.water_quality_advisories (site_id, is_active, effective_at DESC);

GRANT SELECT ON public.water_quality_advisories TO anon, authenticated;
GRANT ALL ON public.water_quality_advisories TO service_role;
ALTER TABLE public.water_quality_advisories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read water_quality_advisories" ON public.water_quality_advisories;
CREATE POLICY "Public read water_quality_advisories"
  ON public.water_quality_advisories FOR SELECT
  TO anon, authenticated
  USING (true);


-- ============================================================================
-- 8. river_gauges - 4 columns added during the gap
-- ============================================================================
ALTER TABLE public.river_gauges ADD COLUMN IF NOT EXISTS is_tidal        boolean DEFAULT false;
ALTER TABLE public.river_gauges ADD COLUMN IF NOT EXISTS noaa_station_id text;
ALTER TABLE public.river_gauges ADD COLUMN IF NOT EXISTS datum           text DEFAULT 'MLLW'::text;
ALTER TABLE public.river_gauges ADD COLUMN IF NOT EXISTS tidal_notes     text;


-- ============================================================================
-- 9. sites - 15 columns added during the gap, plus constraints, indexes, and
--    the SELECT-policy change.
--
--    POLICY CHANGE (explicit): the initial migration created
--      "Sites are publicly readable"  FOR SELECT TO anon, authenticated USING (true)
--    Production instead has
--      "Official sites are publicly readable"  ... USING (status = 'official')
--    Effect: anon and authenticated clients can SELECT only rows where
--    status = 'official'. Rows with status = 'personal' are readable through
--    the PostgREST client by no one (sites has exactly one SELECT policy in
--    live). Personal sites are reached ONLY via service_role, which bypasses
--    RLS, on two paths:
--      (a) src/routes/api/sites.ts calls get_sites_with_latest_reading's 3-arg
--          form (user_lat, user_lng, requesting_user_id) through the
--          service-role client; the function's
--          "status = 'official' OR owner_id = requesting_user_id" predicate
--          scopes the result. The function is SECURITY INVOKER, so that
--          predicate only returns personal rows because the invoker here is
--          service_role - a logged-in user hitting sites directly still cannot.
--      (b) src/lib/userSites.functions.ts does service-role sites CRUD scoped
--          by owner_id = userId in application code.
--    This migration records a restriction already live in production and
--    merely missing from the repo.
-- ============================================================================
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS nearest_gauge_id       uuid;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS is_tidal               boolean DEFAULT false;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS min_navigable_ft       numeric;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS tidal_gauge_station_id text;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS water_body             text;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS num_ramps              smallint;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS access_type            text;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS driving_directions     text;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS county                 text;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS region                 text;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS state_code             text DEFAULT 'MD'::text;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS owner_id               uuid;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS status                 text NOT NULL DEFAULT 'official'::text;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS source                 text;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS source_external_id     text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'sites_status_check'
                   AND conrelid = 'public.sites'::regclass) THEN
    ALTER TABLE public.sites ADD CONSTRAINT sites_status_check
      CHECK (status = ANY (ARRAY['official'::text, 'personal'::text]));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'sites_nearest_gauge_id_fkey'
                   AND conrelid = 'public.sites'::regclass) THEN
    ALTER TABLE public.sites ADD CONSTRAINT sites_nearest_gauge_id_fkey
      FOREIGN KEY (nearest_gauge_id) REFERENCES public.river_gauges(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'sites_owner_id_fkey'
                   AND conrelid = 'public.sites'::regclass) THEN
    ALTER TABLE public.sites ADD CONSTRAINT sites_owner_id_fkey
      FOREIGN KEY (owner_id) REFERENCES auth.users(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sites_owner
  ON public.sites (owner_id) WHERE owner_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sites_official_name_lat_lng_key
  ON public.sites (name, lat, lng) WHERE owner_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sites_personal_name_lat_lng_owner_key
  ON public.sites (name, lat, lng, owner_id) WHERE owner_id IS NOT NULL;

DROP POLICY IF EXISTS "Sites are publicly readable" ON public.sites;
DROP POLICY IF EXISTS "Official sites are publicly readable" ON public.sites;
CREATE POLICY "Official sites are publicly readable"
  ON public.sites FOR SELECT
  TO anon, authenticated
  USING (status = 'official'::text);


-- ============================================================================
-- 10. readings - monitoring_station_id added during the gap
-- ============================================================================
ALTER TABLE public.readings ADD COLUMN IF NOT EXISTS monitoring_station_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'readings_monitoring_station_id_fkey'
                   AND conrelid = 'public.readings'::regclass) THEN
    ALTER TABLE public.readings ADD CONSTRAINT readings_monitoring_station_id_fkey
      FOREIGN KEY (monitoring_station_id)
      REFERENCES public.monitoring_stations(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_readings_station
  ON public.readings (monitoring_station_id);


-- ============================================================================
-- 11. gauge_readings - reconcile the SELECT policy to live.
--     20260603032545 (edited) creates "Public read"; 20260606105601 adds
--     "Gauge readings are publicly readable". Live keeps only the latter.
-- ============================================================================
DROP POLICY IF EXISTS "Public read" ON public.gauge_readings;


-- ============================================================================
-- 12. rain_events - precipitation_inches_24h. Already added by the applied
--     20260905114007; repeated here so this baseline is self-contained.
-- ============================================================================
ALTER TABLE public.rain_events ADD COLUMN IF NOT EXISTS precipitation_inches_24h double precision;


-- ============================================================================
-- 13. Functions added / changed during the gap.
--     Verbatim from live (pg_get_functiondef, 2026-09-08).
-- ============================================================================

-- get_sites_with_latest_reading: the initial migration created a 2-arg version.
-- Live has a 3-arg version. Drop the 2-arg first: leaving both, with the 3rd
-- arg defaulted, makes get_sites_with_latest_reading(lat, lng) ambiguous.
-- On production the 2-arg no longer exists, so the DROP is a no-op there.
DROP FUNCTION IF EXISTS public.get_sites_with_latest_reading(double precision, double precision);

CREATE OR REPLACE FUNCTION public.get_sites_with_latest_reading(user_lat double precision, user_lng double precision, requesting_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(site_id uuid, name text, slug text, site_type text, water_body_type text, lat double precision, lng double precision, address text, description text, amenities text[], parking_notes text, ada_accessible boolean, osm_id text, data_source_ids text[], is_active boolean, reading_id uuid, sampled_at timestamp with time zone, ingested_at timestamp with time zone, e_coli_mpn double precision, enterococci_cce double precision, sample_method text, data_source text, source_url text, status text, notes text, distance_km double precision)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    s.id AS site_id,
    s.name,
    s.slug,
    s.site_type,
    s.water_body_type,
    s.lat,
    s.lng,
    s.address,
    s.description,
    s.amenities,
    s.parking_notes,
    s.ada_accessible,
    s.osm_id,
    s.data_source_ids,
    s.is_active,
    r.id AS reading_id,
    r.sampled_at,
    r.ingested_at,
    r.e_coli_mpn,
    r.enterococci_cce,
    r.sample_method,
    r.data_source,
    r.source_url,
    r.status,
    r.notes,
    (111.045 * sqrt(
      power(s.lat - user_lat, 2) +
      power((s.lng - user_lng) * cos(radians(user_lat)), 2)
    ))::float8 AS distance_km
  FROM public.sites s
  LEFT JOIN LATERAL (
    SELECT *
    FROM public.readings
    WHERE site_id = s.id
    ORDER BY sampled_at DESC
    LIMIT 1
  ) r ON true
  WHERE s.is_active = true
    AND (
      s.status = 'official'                       -- everyone sees official sites
      OR s.owner_id = requesting_user_id          -- caller sees only their own private sites
    )
  ORDER BY distance_km ASC;
$function$;

GRANT EXECUTE ON FUNCTION public.get_sites_with_latest_reading(double precision, double precision, uuid)
  TO anon, authenticated, service_role;


CREATE OR REPLACE FUNCTION public.get_current_tide(p_station_id text, p_at timestamp with time zone DEFAULT now())
 RETURNS TABLE(height_ft numeric, direction text, next_event_type text, next_event_time timestamp with time zone, minutes_to_slack integer, prev_event_type text, prev_event_time timestamp with time zone, prev_height_ft numeric, next_height_ft numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH
  before_now AS (
    SELECT predicted_at, height_ft, type
    FROM tidal_predictions
    WHERE noaa_station_id = p_station_id
      AND predicted_at <= p_at
    ORDER BY predicted_at DESC
    LIMIT 1
  ),
  after_now AS (
    SELECT predicted_at, height_ft, type
    FROM tidal_predictions
    WHERE noaa_station_id = p_station_id
      AND predicted_at > p_at
    ORDER BY predicted_at ASC
    LIMIT 1
  ),
  interpolated AS (
    SELECT
      ROUND(
        b.height_ft + (
          (a.height_ft - b.height_ft) *
          EXTRACT(EPOCH FROM (p_at - b.predicted_at)) /
          NULLIF(EXTRACT(EPOCH FROM (a.predicted_at - b.predicted_at)), 0)
        ), 2
      )                                           AS height_ft,
      CASE WHEN a.type = 'H' THEN 'Flooding' ELSE 'Ebbing' END AS direction,
      a.type                                      AS next_event_type,
      a.predicted_at                              AS next_event_time,
      ROUND(EXTRACT(EPOCH FROM (a.predicted_at - p_at)) / 60)::INTEGER
                                                  AS minutes_to_slack,
      b.type                                      AS prev_event_type,
      b.predicted_at                              AS prev_event_time,
      b.height_ft                                 AS prev_height_ft,
      a.height_ft                                 AS next_height_ft
    FROM before_now b, after_now a
  )
  SELECT * FROM interpolated;
$function$;

GRANT EXECUTE ON FUNCTION public.get_current_tide(text, timestamp with time zone)
  TO anon, authenticated, service_role;


CREATE OR REPLACE FUNCTION public.calculate_trip_waypoints(p_waypoints jsonb, p_departure_time timestamp with time zone DEFAULT now(), p_speed_knots numeric DEFAULT 3.0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result      JSONB := '[]'::JSONB;
  v_waypoint    JSONB;
  v_prev        JSONB;
  v_elapsed     NUMERIC := 0;
  v_dist_nm     NUMERIC;
  v_travel_min  NUMERIC;
  v_arrive_at   TIMESTAMPTZ;
  v_tide        RECORD;
  v_lat1        NUMERIC;
  v_lon1        NUMERIC;
  v_lat2        NUMERIC;
  v_lon2        NUMERIC;
  v_dlat        NUMERIC;
  v_dlon        NUMERIC;
  v_a           NUMERIC;
  v_i           INTEGER := 0;
BEGIN
  FOR v_waypoint IN
    SELECT * FROM jsonb_array_elements(p_waypoints)
  LOOP
    IF v_i = 0 THEN
      v_arrive_at  := p_departure_time;
      v_dist_nm    := 0;
      v_travel_min := 0;
    ELSE
      v_lat1 := (v_prev->>'lat')::NUMERIC;
      v_lon1 := (v_prev->>'lng')::NUMERIC;
      v_lat2 := (v_waypoint->>'lat')::NUMERIC;
      v_lon2 := (v_waypoint->>'lng')::NUMERIC;

      v_dlat := RADIANS(v_lat2 - v_lat1);
      v_dlon := RADIANS(v_lon2 - v_lon1);
      v_a := SIN(v_dlat/2)^2
             + COS(RADIANS(v_lat1))
             * COS(RADIANS(v_lat2))
             * SIN(v_dlon/2)^2;
      v_dist_nm    := 2 * 3440.065 * ASIN(SQRT(v_a));
      v_travel_min := (v_dist_nm / p_speed_knots) * 60;
      v_elapsed    := v_elapsed + v_travel_min;
      v_arrive_at  := p_departure_time
                      + (v_elapsed || ' minutes')::INTERVAL;
    END IF;

    IF v_waypoint->>'noaa_station_id' IS NOT NULL THEN
      SELECT * INTO v_tide FROM get_current_tide(
        v_waypoint->>'noaa_station_id',
        v_arrive_at
      );
    END IF;

    v_result := v_result || jsonb_build_object(
      'order_index',           v_i,
      'name',                  v_waypoint->>'name',
      'lat',                   v_waypoint->>'lat',
      'lng',                   v_waypoint->>'lng',
      'noaa_station_id',       v_waypoint->>'noaa_station_id',
      'estimated_arrival_at',  v_arrive_at,
      'distance_from_prev_nm', ROUND(v_dist_nm::NUMERIC, 2),
      'travel_time_minutes',   ROUND(v_travel_min::NUMERIC),
      'tide_height_ft',        v_tide.height_ft,
      'tide_direction',        v_tide.direction,
      'minutes_to_slack',      v_tide.minutes_to_slack
    );

    v_prev := v_waypoint;
    v_i    := v_i + 1;
  END LOOP;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.calculate_trip_waypoints(jsonb, timestamp with time zone, numeric)
  TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.find_best_departure(p_origin_station text, p_dest_station text, p_date date DEFAULT CURRENT_DATE, p_travel_minutes integer DEFAULT 90, p_paddling_speed_kts numeric DEFAULT 3.0)
 RETURNS TABLE(departure_time timestamp with time zone, departure_tide_state text, departure_direction text, arrival_time timestamp with time zone, arrival_tide_state text, arrival_direction text, return_departure_time timestamp with time zone, return_tide_state text, return_direction text, estimated_home_time timestamp with time zone, window_quality text, recommendation text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scan_time       TIMESTAMPTZ;
  v_scan_end        TIMESTAMPTZ;
  v_arrival_time    TIMESTAMPTZ;
  v_return_dep      TIMESTAMPTZ;
  v_home_time       TIMESTAMPTZ;
  v_dep_tide        RECORD;
  v_arr_tide        RECORD;
  v_ret_tide        RECORD;
  v_home_tide       RECORD;
  v_quality         TEXT;
  v_rec             TEXT;
BEGIN
  v_scan_time := p_date::TIMESTAMPTZ;
  v_scan_end  := p_date::TIMESTAMPTZ + INTERVAL '24 hours';

  WHILE v_scan_time < v_scan_end LOOP
    v_arrival_time := v_scan_time +
                      (p_travel_minutes || ' minutes')::INTERVAL;
    v_return_dep   := v_arrival_time + INTERVAL '30 minutes';
    v_home_time    := v_return_dep +
                      (p_travel_minutes || ' minutes')::INTERVAL;

    SELECT * INTO v_dep_tide
      FROM get_current_tide(p_origin_station, v_scan_time);
    SELECT * INTO v_arr_tide
      FROM get_current_tide(p_dest_station, v_arrival_time);
    SELECT * INTO v_ret_tide
      FROM get_current_tide(p_dest_station, v_return_dep);
    SELECT * INTO v_home_tide
      FROM get_current_tide(p_origin_station, v_home_time);

    CONTINUE WHEN v_dep_tide IS NULL OR v_arr_tide IS NULL;

    v_quality := 'poor';
    v_rec := NULL;

    IF v_dep_tide.direction = 'Flooding'
       AND v_ret_tide.direction = 'Ebbing' THEN
      v_quality := 'good';
      v_rec := 'Tidal assist both ways — flood out, ebb home';
    ELSIF v_dep_tide.direction = 'Ebbing'
       AND v_ret_tide.direction = 'Flooding' THEN
      v_quality := 'good';
      v_rec := 'Tidal assist both ways — ebb out, flood home';
    ELSIF v_dep_tide.minutes_to_slack <= 45 THEN
      v_quality := 'fair';
      v_rec := 'Launch near slack — minimal current both ways';
    ELSIF v_arr_tide.minutes_to_slack <= 45 THEN
      v_quality := 'fair';
      v_rec := 'Arrive near slack — good timing at destination';
    ELSE
      v_quality := 'poor';
      v_rec := 'No tidal advantage at this departure time';
    END IF;

    departure_time        := v_scan_time;
    departure_tide_state  := v_dep_tide.direction
                             || ' ' || v_dep_tide.height_ft || 'ft';
    departure_direction   := v_dep_tide.direction;
    arrival_time          := v_arrival_time;
    arrival_tide_state    := v_arr_tide.direction
                             || ' ' || v_arr_tide.height_ft || 'ft';
    arrival_direction     := v_arr_tide.direction;
    return_departure_time := v_return_dep;
    return_tide_state     := v_ret_tide.direction
                             || ' ' || v_ret_tide.height_ft || 'ft';
    return_direction      := v_ret_tide.direction;
    estimated_home_time   := v_home_time;
    window_quality        := v_quality;
    recommendation        := v_rec;

    RETURN NEXT;

    v_scan_time := v_scan_time + INTERVAL '30 minutes';
  END LOOP;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.find_best_departure(text, text, date, integer, numeric)
  TO anon, authenticated;


-- ============================================================================
-- 14. Views added during the gap. security_invoker = true (verified live).
-- ============================================================================
CREATE OR REPLACE VIEW public.v_todays_tides
  WITH (security_invoker = true) AS
 SELECT noaa_station_id,
    type,
    predicted_at,
    height_ft,
    row_number() OVER (PARTITION BY noaa_station_id ORDER BY predicted_at) AS event_order
   FROM tidal_predictions
  WHERE predicted_at::date = CURRENT_DATE
  ORDER BY noaa_station_id, predicted_at;

CREATE OR REPLACE VIEW public.v_upcoming_tides
  WITH (security_invoker = true) AS
 SELECT noaa_station_id,
    type,
    predicted_at,
    height_ft,
    predicted_at::date AS tide_date,
    row_number() OVER (PARTITION BY noaa_station_id, (predicted_at::date) ORDER BY predicted_at) AS event_order
   FROM tidal_predictions
  WHERE predicted_at >= CURRENT_DATE AND predicted_at < (CURRENT_DATE + '7 days'::interval)
  ORDER BY noaa_station_id, predicted_at;

GRANT SELECT ON public.v_todays_tides   TO anon, authenticated;
GRANT SELECT ON public.v_upcoming_tides TO anon, authenticated;


-- ============================================================================
-- 15. Data fix, folded in from the unapplied 20260611191534. Idempotent:
--     no-op on a fresh reset (table empty) and on production (already prefixed).
-- ============================================================================
UPDATE public.tidal_predictions
SET noaa_station_id = 'NOAA-' || noaa_station_id
WHERE noaa_station_id NOT LIKE 'NOAA-%';
