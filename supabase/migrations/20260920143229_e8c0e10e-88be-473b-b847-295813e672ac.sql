CREATE TABLE IF NOT EXISTS public.weekly_report_state (
  id text PRIMARY KEY DEFAULT 'weekly_feedback',
  last_sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.weekly_report_state TO service_role;

ALTER TABLE public.weekly_report_state ENABLE ROW LEVEL SECURITY;

INSERT INTO public.weekly_report_state (id, last_sent_at)
VALUES ('weekly_feedback', NULL)
ON CONFLICT (id) DO NOTHING;