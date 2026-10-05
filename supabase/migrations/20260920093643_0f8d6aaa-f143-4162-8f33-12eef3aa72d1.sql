CREATE TABLE IF NOT EXISTS public.preview_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL,
  prompt_key text NOT NULL,
  response_value text,
  response_text text,
  page_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.preview_feedback
  DROP CONSTRAINT IF EXISTS preview_feedback_response_text_length;
ALTER TABLE public.preview_feedback
  ADD CONSTRAINT preview_feedback_response_text_length
  CHECK (response_text IS NULL OR char_length(response_text) <= 2000);

CREATE INDEX IF NOT EXISTS preview_feedback_prompt_key_idx ON public.preview_feedback (prompt_key);
CREATE INDEX IF NOT EXISTS preview_feedback_device_id_idx ON public.preview_feedback (device_id);

GRANT INSERT ON public.preview_feedback TO anon, authenticated;
GRANT ALL ON public.preview_feedback TO service_role;

ALTER TABLE public.preview_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can submit preview feedback" ON public.preview_feedback;
CREATE POLICY "Anyone can submit preview feedback"
  ON public.preview_feedback
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);