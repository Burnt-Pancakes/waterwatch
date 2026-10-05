CREATE TABLE public.weather_alert_notifications (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id      uuid        NOT NULL REFERENCES public.alerts(id) ON DELETE CASCADE,
  nws_alert_id  text        NOT NULL,
  notified_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alert_id, nws_alert_id)
);

CREATE INDEX weather_alert_notifications_alert_id_idx
  ON public.weather_alert_notifications (alert_id);

GRANT ALL ON public.weather_alert_notifications TO service_role;
ALTER TABLE public.weather_alert_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "weather_alert_notifications_service_role_only"
  ON public.weather_alert_notifications
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

ALTER TABLE rain_events ADD COLUMN IF NOT EXISTS precipitation_inches_24h float;