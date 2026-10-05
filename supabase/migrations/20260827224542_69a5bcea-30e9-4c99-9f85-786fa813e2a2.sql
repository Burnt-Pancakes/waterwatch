CREATE OR REPLACE FUNCTION public.bulk_update_last_sample_at(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH incoming AS (
    SELECT (elem->>'id')::uuid AS id,
           (elem->>'ts')::timestamptz AS ts
    FROM jsonb_array_elements(p_rows) AS elem
  ), updated AS (
    UPDATE public.monitoring_stations ms
    SET last_sample_at = i.ts
    FROM incoming i
    WHERE ms.id = i.id
      AND (ms.last_sample_at IS DISTINCT FROM i.ts)
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM updated;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_update_last_sample_at(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_update_last_sample_at(jsonb) TO service_role;