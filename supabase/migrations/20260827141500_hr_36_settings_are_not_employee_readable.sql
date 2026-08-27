-- =============================================================================
-- Attendance settings stop being readable by every member of staff.
--
-- WHY NOW. hr_32 added the anti-spoofing configuration to this table --
-- max_accuracy_metres, reject_mock_location, max_plausible_speed_kmh,
-- trusted_proxy_hops. The existing read policy was hr_is_staff(), i.e. every
-- employee, which was harmless when the row held office hours and grace
-- minutes and is not harmless now: it tells anyone who asks exactly which
-- accuracy value slips past the check and whether a faked position is refused
-- or merely flagged. That is the security configuration itself.
--
-- SAFE. Nothing employee-facing reads this table. The punch card gets office
-- hours, the punch window and the location verdict from hr_punch_state, a
-- SECURITY DEFINER function that bypasses RLS and returns a curated subset --
-- which is precisely why it was written that way. The only callers of the
-- table itself are the HR attendance admin screens, and they already require
-- attendance permission to do anything with what they read.
-- =============================================================================

DROP POLICY IF EXISTS hr_attendance_settings_read ON public.hr_attendance_settings;

CREATE POLICY hr_attendance_settings_read ON public.hr_attendance_settings
  FOR SELECT TO authenticated
  USING ((SELECT hr_can_view('attendance')));

COMMENT ON TABLE public.hr_attendance_settings IS
  'Attendance policy AND the location/anti-spoofing configuration. HR-readable only: an employee who could read max_accuracy_metres and reject_mock_location would know exactly what a spoofed position has to look like. Employee-facing values reach the punch card through hr_punch_state.';
