DROP POLICY IF EXISTS "arlington-data deny client access" ON storage.objects;

CREATE POLICY "arlington-data deny client access"
ON storage.objects
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (bucket_id <> 'arlington-data')
WITH CHECK (bucket_id <> 'arlington-data');