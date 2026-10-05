
-- ============================================================
-- WaterVoice-DMV initial schema
-- ============================================================

-- 1) sites
CREATE TABLE public.sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  site_type text NOT NULL CHECK (site_type IN ('kayak_launch','boat_ramp','beach','swim_area','fishing_access','marina')),
  water_body_type text NOT NULL CHECK (water_body_type IN ('freshwater','tidal_brackish')),
  lat float8 NOT NULL,
  lng float8 NOT NULL,
  address text,
  description text,
  amenities text[] NOT NULL DEFAULT '{}',
  parking_notes text,
  ada_accessible boolean NOT NULL DEFAULT false,
  osm_id text UNIQUE,
  data_source_ids text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.sites TO anon, authenticated;
GRANT ALL ON public.sites TO service_role;
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;

-- Public read: water quality info must be visible without login
CREATE POLICY "Sites are publicly readable" ON public.sites
  FOR SELECT TO anon, authenticated USING (true);
-- No INSERT/UPDATE/DELETE policies => only service_role (bypasses RLS) may write

CREATE INDEX sites_site_type_idx ON public.sites (site_type);
CREATE INDEX sites_water_body_type_idx ON public.sites (water_body_type);
CREATE INDEX sites_is_active_idx ON public.sites (is_active);

-- 2) readings
CREATE TABLE public.readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  sampled_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  e_coli_mpn float8,
  enterococci_cce float8,
  sample_method text,
  data_source text NOT NULL,
  source_url text,
  status text NOT NULL CHECK (status IN ('pass','caution','unsafe','no_data')),
  raw_payload jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, sampled_at, data_source)
);

GRANT SELECT ON public.readings TO anon, authenticated;
GRANT ALL ON public.readings TO service_role;
ALTER TABLE public.readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Readings are publicly readable" ON public.readings
  FOR SELECT TO anon, authenticated USING (true);

-- (site_id, sampled_at desc) supports "latest reading per site" lookups
CREATE INDEX readings_site_sampled_idx ON public.readings (site_id, sampled_at DESC);
CREATE INDEX readings_status_idx ON public.readings (status);
CREATE INDEX readings_data_source_idx ON public.readings (data_source);

-- 3) user_profiles
CREATE TABLE public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  email_alerts_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_profiles TO authenticated;
GRANT ALL ON public.user_profiles TO service_role;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own profile" ON public.user_profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.user_profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
-- Insert handled by trigger on auth.users (service-role context); no INSERT policy needed for users

-- 4) favorites
CREATE TABLE public.favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, site_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.favorites TO authenticated;
GRANT ALL ON public.favorites TO service_role;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own favorites" ON public.favorites
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own favorites" ON public.favorites
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own favorites" ON public.favorites
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own favorites" ON public.favorites
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 5) alerts
CREATE TABLE public.alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  trigger_on text[] NOT NULL DEFAULT ARRAY['caution','unsafe'],
  is_active boolean NOT NULL DEFAULT true,
  last_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, site_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.alerts TO authenticated;
GRANT ALL ON public.alerts TO service_role;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own alerts" ON public.alerts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own alerts" ON public.alerts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own alerts" ON public.alerts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own alerts" ON public.alerts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 6) rain_events
CREATE TABLE public.rain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recorded_at timestamptz NOT NULL,
  precipitation_inches_48h float8 NOT NULL,
  station_id text,
  advisory_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.rain_events TO anon, authenticated;
GRANT ALL ON public.rain_events TO service_role;
ALTER TABLE public.rain_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Rain events are publicly readable" ON public.rain_events
  FOR SELECT TO anon, authenticated USING (true);

-- ============================================================
-- updated_at triggers
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER sites_set_updated_at
  BEFORE UPDATE ON public.sites
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TRIGGER user_profiles_set_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- New-user trigger: auto-create user_profiles row
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Runs as definer so it bypasses RLS to insert into public.user_profiles.
  -- ON CONFLICT guards against duplicate triggers / replays during signup.
  INSERT INTO public.user_profiles (id, display_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'display_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- get_sites_with_latest_reading(user_lat, user_lng)
-- Returns all active sites + their most recent reading + distance_km.
-- Distance uses equirectangular approximation (no PostGIS).
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_sites_with_latest_reading(
  user_lat float8,
  user_lng float8
)
RETURNS TABLE (
  site_id uuid,
  name text,
  slug text,
  site_type text,
  water_body_type text,
  lat float8,
  lng float8,
  address text,
  description text,
  amenities text[],
  parking_notes text,
  ada_accessible boolean,
  osm_id text,
  data_source_ids text[],
  is_active boolean,
  reading_id uuid,
  sampled_at timestamptz,
  ingested_at timestamptz,
  e_coli_mpn float8,
  enterococci_cce float8,
  sample_method text,
  data_source text,
  source_url text,
  status text,
  notes text,
  distance_km float8
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  -- For each active site, pick the most recent reading via DISTINCT ON,
  -- then compute equirectangular distance (good enough at DMV latitudes
  -- and avoids the PostGIS dependency banned by project rules).
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
  ORDER BY distance_km ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_sites_with_latest_reading(float8, float8)
  TO anon, authenticated, service_role;

-- ============================================================
-- get_site_readings_history(p_site_id, days_back default 90)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_site_readings_history(
  p_site_id uuid,
  days_back int DEFAULT 90
)
RETURNS SETOF public.readings
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT *
  FROM public.readings
  WHERE site_id = p_site_id
    AND sampled_at >= now() - make_interval(days => days_back)
  ORDER BY sampled_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_site_readings_history(uuid, int)
  TO anon, authenticated, service_role;
