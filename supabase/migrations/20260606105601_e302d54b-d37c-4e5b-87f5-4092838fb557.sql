-- ============================================================================
-- EDITED 2026-09-08, after this migration was already applied to production
-- (supabase_migrations.schema_migrations version 20260606105601). Production
-- will NOT re-run it.
--
-- Four statements targeting public.stage_thresholds were removed:
--   GRANT SELECT ON public.stage_thresholds TO anon, authenticated;
--   GRANT ALL    ON public.stage_thresholds TO service_role;
--   ALTER TABLE  public.stage_thresholds ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY "Stage thresholds are publicly readable"
--     ON public.stage_thresholds FOR SELECT TO anon, authenticated USING (true);
--
-- stage_thresholds is not created by any applied migration (Lovable created it
-- internally during the June-August 2026 gap), so on a fresh `supabase db
-- reset` those statements failed at the first GRANT ("relation ... does not
-- exist"). 20260909000000_reconcile_live_schema.sql now creates
-- stage_thresholds and owns its grants + RLS policy.
--
-- This file now documents INTENDED current state, not literal history.
-- ============================================================================

GRANT SELECT ON public.river_gauges TO anon, authenticated;
GRANT SELECT ON public.gauge_readings TO anon, authenticated;
GRANT ALL ON public.river_gauges TO service_role;
GRANT ALL ON public.gauge_readings TO service_role;

ALTER TABLE public.gauge_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Gauge readings are publicly readable"
  ON public.gauge_readings FOR SELECT
  TO anon, authenticated
  USING (true);
