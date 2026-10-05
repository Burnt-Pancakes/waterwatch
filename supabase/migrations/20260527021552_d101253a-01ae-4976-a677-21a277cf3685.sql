
-- Make the deny intent explicit so the linter sees a policy.
CREATE POLICY "deny all client access" ON public.auth_rate_limits
  AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- service_role already has full DELETE rights and bypasses RLS, so DEFINER buys us nothing.
CREATE OR REPLACE FUNCTION public.purge_old_auth_rate_limits()
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  DELETE FROM public.auth_rate_limits
  WHERE attempted_at < now() - interval '24 hours';
$$;

REVOKE ALL ON FUNCTION public.purge_old_auth_rate_limits() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_auth_rate_limits() TO service_role;
