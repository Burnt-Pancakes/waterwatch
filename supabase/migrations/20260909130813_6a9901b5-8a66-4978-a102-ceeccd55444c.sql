-- Broaden auth_rate_limits.kind to accept the API rate-limit kinds.
--
-- public.auth_rate_limits was created by 20260527021533 with an inline CHECK
-- allowing only the four auth kinds (signin, signup, reset, magic_link).
-- src/lib/apiRoute.server.ts::checkApiRateLimit writes five more kinds from the
-- /api routes (api_sites, api_sites_detail, api_sites_readings, api_explain,
-- api_guest_alert). Every one of those INSERTs currently fails the CHECK; the
-- error is logged and swallowed, the counter never increments, and the limit
-- is never reached, so those five routes are unthrottled (fail-open).
--
-- 20260528000001 (docs/held-migrations/) proposed the same broaden as part of a
-- larger change that was held; this migration carries only the CHECK fix.
--
-- Broaden-only: all four existing values remain valid, so ADD CONSTRAINT
-- validates instantly against production data (which contains only the four
-- auth kinds - the api_* rows were always rejected). Idempotent via
-- DROP CONSTRAINT IF EXISTS.

ALTER TABLE public.auth_rate_limits
  DROP CONSTRAINT IF EXISTS auth_rate_limits_kind_check;

-- Adding an api_* kind? This CHECK must be updated in the same change, or the
-- route's rate-limit INSERT will fail and the route will run unthrottled.
-- The coupling is not visible from the route code.
--
--   kind                  writer                                        limit
--   --------------------  --------------------------------------------  --------
--   signin                src/lib/auth/rateLimit.server.ts             5 / 15m
--   signup                src/lib/auth/rateLimit.server.ts             5 / 15m
--   reset                 src/lib/auth/rateLimit.server.ts             5 / 15m
--   magic_link            src/lib/auth/rateLimit.server.ts             5 / 15m
--   api_sites             src/routes/api/sites.ts                      100 / 60s
--   api_sites_detail      src/routes/api/sites/[slug].ts               100 / 60s
--   api_sites_readings    src/routes/api/sites/[slug]/readings.ts      100 / 60s
--   api_explain           src/routes/api/explain.ts                    10 / 1h
--   api_guest_alert       src/routes/api/guest-alert.ts                10 / 1h
--
ALTER TABLE public.auth_rate_limits
  ADD CONSTRAINT auth_rate_limits_kind_check
  CHECK (kind = ANY (ARRAY[
    'signin'::text,
    'signup'::text,
    'reset'::text,
    'magic_link'::text,
    'api_sites'::text,
    'api_sites_detail'::text,
    'api_sites_readings'::text,
    'api_explain'::text,
    'api_guest_alert'::text
  ]));