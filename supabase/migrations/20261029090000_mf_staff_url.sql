-- Staff shortcut to the MF platform's distributor dashboard.
--
-- The CRM sidebar links admins and employees to the platform's own dashboard
-- (staff sign in there; staff SSO is not specced yet). The URL carries the
-- platform's name, and the CRM ships in the same public bundle as the client
-- portal, so the URL lives here and is handed only to active staff — never to
-- clients, partners or the Transfer Admin login.

CREATE OR REPLACE FUNCTION public.nw_mf_staff_url()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT 'https://crmv2.wylth.com/dashboard/'::text
  WHERE EXISTS (
    SELECT 1 FROM nw_employees
    WHERE auth_user_id = auth.uid()
      AND status = 'active'
      AND role IN ('admin', 'super_admin', 'employee')
  );
$function$;

-- REVOKE FROM PUBLIC, anon does not take EXECUTE away from authenticated (see
-- the REVOKE gotcha); the staff check above is what keeps clients out.
REVOKE ALL ON FUNCTION public.nw_mf_staff_url() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nw_mf_staff_url() TO authenticated;
