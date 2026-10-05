CREATE TABLE public.ingest_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_name TEXT NOT NULL DEFAULT 'fetch-water-quality',
  started_at TIMESTAMP WITH TIME ZONE NOT NULL,
  finished_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  status TEXT NOT NULL CHECK (status IN ('ok', 'ok_with_errors', 'failed')),
  rows_upserted INTEGER NOT NULL DEFAULT 0,
  tiles_processed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  summary JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Internal ops log: written by the edge function via service role only.
-- No grants to anon/authenticated — RLS stays enabled with zero policies,
-- which denies all non-service-role access by default.
GRANT ALL ON public.ingest_runs TO service_role;
ALTER TABLE public.ingest_runs ENABLE ROW LEVEL SECURITY;

CREATE INDEX ingest_runs_finished_at_idx ON public.ingest_runs (finished_at DESC);