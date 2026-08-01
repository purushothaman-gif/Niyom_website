/*
  # Client profile photos

  Clients can set a profile picture — during onboarding, or later from Profile →
  Settings. The portal has shown a single initial in a circle since launch, which
  is fine as a fallback and thin as an identity.

  ## Storage policy, learned the hard way

  The `employee-avatars` bucket cost three migrations to get right. The finding
  (20260727170000): the storage API's upload path needs a SELECT policy for the
  authenticated role, and once that exists, a SECURITY DEFINER helper DOES
  resolve inside the write check. Both lessons are applied here from the start:
  SELECT for authenticated, and writes scoped by `nw_current_client_code()`,
  which already backs client RLS elsewhere.

  Paths are `<client_code>/<timestamp>.<ext>`, so the folder IS the scope: a
  client can only write under their own code. Uploads never upsert (each file is
  uniquely named), matching how onboarding KYC documents already upload.
*/

ALTER TABLE nw_clients ADD COLUMN IF NOT EXISTS avatar_url text;

COMMENT ON COLUMN nw_clients.avatar_url IS
  'Public URL of the client''s profile photo in the client-avatars bucket. Null → initials.';

/* Public bucket: a profile photo is not confidential, and a public URL means the
   portal renders it without minting a signed URL on every page. */
INSERT INTO storage.buckets (id, name, public)
VALUES ('client-avatars', 'client-avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

/* READ: required by the storage API upload path; the bucket is public anyway. */
DROP POLICY IF EXISTS "Authenticated can read client avatars" ON storage.objects;
CREATE POLICY "Authenticated can read client avatars"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'client-avatars');

/* WRITE: only into your own folder. Employees are deliberately not granted
   write here — a client's photo is theirs to set. */
DROP POLICY IF EXISTS "Clients can upload their own avatar" ON storage.objects;
CREATE POLICY "Clients can upload their own avatar"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'client-avatars'
    AND (storage.foldername(name))[1] = public.nw_current_client_code()
  );

DROP POLICY IF EXISTS "Clients can replace their own avatar" ON storage.objects;
CREATE POLICY "Clients can replace their own avatar"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'client-avatars'
    AND (storage.foldername(name))[1] = public.nw_current_client_code()
  )
  WITH CHECK (
    bucket_id = 'client-avatars'
    AND (storage.foldername(name))[1] = public.nw_current_client_code()
  );

DROP POLICY IF EXISTS "Clients can delete their own avatar" ON storage.objects;
CREATE POLICY "Clients can delete their own avatar"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'client-avatars'
    AND (storage.foldername(name))[1] = public.nw_current_client_code()
  );
