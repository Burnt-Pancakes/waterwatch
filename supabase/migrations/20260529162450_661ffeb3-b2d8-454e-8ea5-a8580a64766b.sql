-- Replace the confusing inverted permissive policy on storage.objects with a
-- restrictive deny-all policy for the private 'arlington-data' bucket. The
-- service role (used by server functions) bypasses RLS, so admin code is
-- unaffected; anon and authenticated clients can never read or modify objects
-- in this bucket.

DROP POLICY IF EXISTS "arlington-data no anon access" ON storage.objects;

CREATE POLICY "arlington-data deny client access"
ON storage.objects
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (bucket_id <> 'arlington-data')
WITH CHECK (bucket_id <> 'arlington-data');