
-- Auth rate-limit log: one row per (ip, kind) attempt.
-- Only service_role reads/writes; clients never touch this table.
CREATE TABLE public.auth_rate_limits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip           text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('signin','signup','reset','magic_link')),
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_rate_limits_ip_kind_time_idx
  ON public.auth_rate_limits (ip, kind, attempted_at DESC);

-- Auth-only — no anon, no authenticated. Service role only.
GRANT ALL ON public.auth_rate_limits TO service_role;

ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;

-- No policies = no access for anon/authenticated. Service role bypasses RLS.

-- Housekeeping helper (called by server fn opportunistically).
CREATE OR REPLACE FUNCTION public.purge_old_auth_rate_limits()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.auth_rate_limits
  WHERE attempted_at < now() - interval '24 hours';
$$;

REVOKE ALL ON FUNCTION public.purge_old_auth_rate_limits() FROM public;
GRANT EXECUTE ON FUNCTION public.purge_old_auth_rate_limits() TO service_role;
