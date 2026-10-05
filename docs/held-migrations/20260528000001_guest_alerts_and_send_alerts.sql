-- ============================================================================
-- HELD MIGRATION - deliberately NOT applied. NOT in supabase/migrations/.
--
-- Moved here 2026-09-08 from supabase/migrations/20260528000001_guest_alerts_and_send_alerts.sql
-- so that `supabase db reset` does not glob and run it. A rename inside the
-- migrations directory would not have stopped that.
--
-- STATUS: never applied to production. Verified 2026-09-08 against live:
--   - public.tg_readings_notify_alerts()   absent (pg_proc: no rows)
--   - trigger readings_notify_alerts_tg    absent
--   - auth_rate_limits_kind_check           still the original 4-value CHECK
--                                           (signin/signup/reset/magic_link);
--                                           the broaden in section 1 never ran
--   - public.readings in supabase_realtime  NOT a member; section 3 never ran
--
-- WHAT IT INSTALLS, if ever applied:
--   1. Broadens auth_rate_limits.kind CHECK to also accept the API rate-limit
--      kinds (api_sites, api_sites_detail, api_sites_readings, api_explain,
--      api_guest_alert).
--      NOTE: src/lib/apiRoute.server.ts::checkApiRateLimit already writes these
--      kinds from five /api routes. On production those INSERTs currently fail
--      the CHECK (fail-open: logged, request proceeds, no throttling). Fixing
--      that is tracked as its own commit, independent of this held migration.
--   2. A second public.guest_alerts definition. Superseded by the applied
--      20260530024339_7ae87f23, which is what production actually has:
--      no `email LIKE '%@%'` CHECK, indexes idx_guest_alerts_site_id /
--      idx_guest_alerts_token, policy "deny all client access". The migration
--      squash (20260909000000_reconcile_live_schema.sql) does NOT recreate
--      guest_alerts - the applied migration already does, in the live shape.
--   3. Enables Supabase Realtime on public.readings.
--   4. Vault secret send_alerts_url (placeholder value).
--   5. tg_readings_notify_alerts() + readings_notify_alerts_tg: an AFTER INSERT
--      trigger on public.readings that pg_net-POSTs to the send-alerts edge
--      function for every inserted row.
--
-- WHY HELD: item 5 fires a network POST on every readings INSERT and depends on
-- an operator-populated vault secret; it was never green-lit for production.
-- 20260909000000_reconcile_live_schema.sql intentionally excludes items 3 and 5.
-- ============================================================================

-- ============================================================
-- 1. Broaden auth_rate_limits.kind to include API rate-limit kinds.
--    The original CHECK only allowed auth kinds; API routes use the
--    same table and need additional values.
-- ============================================================
ALTER TABLE public.auth_rate_limits
  DROP CONSTRAINT IF EXISTS auth_rate_limits_kind_check;

ALTER TABLE public.auth_rate_limits
  ADD CONSTRAINT auth_rate_limits_kind_check
  CHECK (kind IN (
    'signin', 'signup', 'reset', 'magic_link',
    'api_sites', 'api_sites_detail', 'api_sites_readings',
    'api_explain', 'api_guest_alert'
  ));

-- ============================================================
-- 2. guest_alerts — one row per (email, site) subscription.
--    No user account required; identified only by email + token.
--    Service-role only (RLS blocks all client access).
-- ============================================================
CREATE TABLE public.guest_alerts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text        NOT NULL CHECK (email LIKE '%@%'),
  site_id    uuid        NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  token      uuid        NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email, site_id)
);

CREATE INDEX guest_alerts_site_id_idx ON public.guest_alerts (site_id);
CREATE INDEX guest_alerts_token_idx   ON public.guest_alerts (token);

GRANT ALL ON public.guest_alerts TO service_role;
ALTER TABLE public.guest_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guest_alerts_service_role_only"
  ON public.guest_alerts
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ============================================================
-- 3. Enable Supabase Realtime on the readings table so the
--    /favorites page can receive live status badge updates.
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.readings;

-- ============================================================
-- 4. Vault secret for the send-alerts edge function URL.
--    Operator must update this after deploying the function.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'send_alerts_url') THEN
    PERFORM vault.create_secret(
      'https://REPLACE_ME.supabase.co/functions/v1/send-alerts',
      'send_alerts_url',
      'URL for the send-alerts edge function (update after deploy)'
    );
  END IF;
END $$;

-- ============================================================
-- 5. Trigger that fires the send-alerts edge function after
--    each new reading INSERT via pg_net (async, non-blocking).
--    Skips silently when the vault entry still has the placeholder.
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_readings_notify_alerts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url text := public._get_vault_secret('send_alerts_url');
  v_key text := public._get_vault_secret('service_role_key');
BEGIN
  -- Skip until the operator has replaced the placeholder URL.
  IF v_url IS NULL OR v_url LIKE '%REPLACE_ME%' THEN
    RETURN NEW;
  END IF;

  PERFORM extensions.net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || coalesce(v_key, '')
               ),
    body    := jsonb_build_object(
                 'reading_id', NEW.id,
                 'site_id',    NEW.site_id
               )
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_readings_notify_alerts()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER readings_notify_alerts_tg
  AFTER INSERT ON public.readings
  FOR EACH ROW EXECUTE FUNCTION public.tg_readings_notify_alerts();
