/*
  # Drop orphan DB functions + empty storage buckets (junk cleanup, round 2)

  Follow-up to 20260726130000_drop_dead_modules.sql. A full reachability audit
  (frontend + edge functions + cron + triggers + policies + defaults + grants)
  found these had no live caller:

  Functions:
   - get_client_login_by_pan(text)   — superseded by the client-pan-login edge fn; no caller.
   - check_and_update_clawback()      — detached trigger fn; the `clawback` column it set
                                        no longer exists (was on the dropped legacy `deals`).
   - set_retention_required()         — detached trigger fn; the `retention_required` column
                                        it set no longer exists (dropped legacy `deals`).
   - update_updated_at_column()       — generic updated_at helper; no trigger uses it
                                        (live tables use their own table-specific helpers).

  Storage buckets (both empty, 0 objects):
   - hrm-avatars       — HRM module retired (moved to Zoho); bucket + its 4 RLS policies.
   - "data base - niyom" — accidental/test bucket (name has spaces), never used.

  Kept deliberately: bm_selling_price() (unused but an intentional server-side pricing
  seam) and the bond-documents bucket (holds real SMC bond-quote import spreadsheets).
*/

DROP FUNCTION IF EXISTS public.get_client_login_by_pan(text);
DROP FUNCTION IF EXISTS public.check_and_update_clawback();
DROP FUNCTION IF EXISTS public.set_retention_required();
DROP FUNCTION IF EXISTS public.update_updated_at_column();

-- hrm-avatars bucket RLS policies.
DROP POLICY IF EXISTS "hrm_avatars_delete" ON storage.objects;
DROP POLICY IF EXISTS "hrm_avatars_insert" ON storage.objects;
DROP POLICY IF EXISTS "hrm_avatars_select" ON storage.objects;
DROP POLICY IF EXISTS "hrm_avatars_update" ON storage.objects;

-- NOTE: the two empty buckets ('hrm-avatars', 'data base - niyom') are deleted via
-- the Storage API (Supabase blocks direct DELETE FROM storage.buckets), not here.
