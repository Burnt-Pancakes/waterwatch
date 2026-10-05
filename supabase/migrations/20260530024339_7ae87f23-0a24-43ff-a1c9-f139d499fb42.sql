CREATE TABLE public.guest_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email, site_id)
);

CREATE INDEX idx_guest_alerts_site_id ON public.guest_alerts(site_id);
CREATE INDEX idx_guest_alerts_token ON public.guest_alerts(token);

GRANT ALL ON public.guest_alerts TO service_role;

ALTER TABLE public.guest_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny all client access"
  ON public.guest_alerts
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
