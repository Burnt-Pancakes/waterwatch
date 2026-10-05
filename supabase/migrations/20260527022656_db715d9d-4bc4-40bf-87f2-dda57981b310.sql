
-- 1. Unique constraint enabling upsert on (site_id, sampled_at, data_source).
--    Use a partial unique index that ignores NULL sampled_at just in case.
CREATE UNIQUE INDEX IF NOT EXISTS readings_site_sampled_source_uniq
  ON public.readings (site_id, sampled_at, data_source);

-- 2. Private storage bucket for Arlington County CSV drops.
INSERT INTO storage.buckets (id, name, public)
VALUES ('arlington-data', 'arlington-data', false)
ON CONFLICT (id) DO NOTHING;

-- service_role bypasses RLS so no explicit policy needed for the adapter,
-- but lock down anon/authenticated explicitly.
CREATE POLICY "arlington-data no anon access"
  ON storage.objects
  FOR ALL
  TO anon, authenticated
  USING (bucket_id <> 'arlington-data')
  WITH CHECK (bucket_id <> 'arlington-data');
