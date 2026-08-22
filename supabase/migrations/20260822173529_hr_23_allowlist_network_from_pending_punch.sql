-- =============================================================================
-- Trust an address straight from the approval queue.
--
-- The queue already shows the server-detected IP of every held punch -- which
-- is the office address, discovered from real traffic rather than guessed. But
-- acting on it meant copying the address, switching tabs, retyping it, saving,
-- coming back, and approving each punch one at a time. On the first day of
-- enforcement that is the whole company's attendance, by hand.
--
-- This does the whole thing in one transaction: allowlist the address, approve
-- every punch still held from it, and recompute each affected day. Either all
-- of it lands or none does -- a half-applied version would leave an allowlisted
-- network with punches still sitting in the queue, which reads as a bug.
--
-- Approving only punches from THIS address is the deliberate limit. It would be
-- easy to add "approve everything pending", and that is exactly the button that
-- turns an off-network punch from a decision into a formality.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.hr_allowlist_network(
  p_ip              inet,
  p_name            text,
  p_location        text    DEFAULT 'Chennai',
  p_approve_pending boolean DEFAULT true,
  p_description     text    DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_net_id    uuid;
  v_existing  uuid;
  v_approved  integer := 0;
  v_employees integer := 0;
  v_me        uuid;
  r           record;
BEGIN
  IF NOT hr_can_edit('attendance') THEN
    RAISE EXCEPTION 'You do not have permission to change the office network list.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_ip IS NULL THEN
    RAISE EXCEPTION 'No address was detected for that punch, so there is nothing to trust.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF COALESCE(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'Give the network a name so it is recognisable later.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Already covered by a live entry (possibly a CIDR that contains it): say so
  -- rather than stacking a second row that matches the same traffic.
  v_existing := hr_match_network(p_ip);
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'That address is already covered by the approved network "%".',
      (SELECT name FROM hr_allowed_networks WHERE id = v_existing)
      USING ERRCODE = 'unique_violation';
  END IF;

  v_me := nw_current_employee_id();

  INSERT INTO hr_allowed_networks (name, location, ip_address, status, description, created_by)
  VALUES (trim(p_name), COALESCE(NULLIF(trim(p_location), ''), 'Chennai'), p_ip, 'active',
          COALESCE(p_description, ''), v_me)
  RETURNING id INTO v_net_id;

  IF p_approve_pending THEN
    -- Only punches from THIS address. Everything else stays a decision.
    FOR r IN
      SELECT id, employee_id, work_date
      FROM hr_attendance_punches
      WHERE approval_status = 'pending' AND detected_ip = p_ip
      ORDER BY punched_at
    LOOP
      UPDATE hr_attendance_punches
         SET approval_status = 'approved',
             approved_by     = v_me,
             approved_at     = now(),
             review_note     = 'Approved automatically when this address was added as an approved office network.'
       WHERE id = r.id;

      PERFORM hr_recompute_daily(r.employee_id, r.work_date);
      v_approved := v_approved + 1;
    END LOOP;

    SELECT count(DISTINCT employee_id) INTO v_employees
    FROM hr_attendance_punches
    WHERE detected_ip = p_ip AND approved_by = v_me AND approved_at > now() - interval '1 minute';
  END IF;

  PERFORM hr_audit('network', v_net_id, 'network_allowlisted_from_queue',
    '{}'::jsonb,
    jsonb_build_object('ip', p_ip::text, 'name', trim(p_name),
                       'punches_approved', v_approved, 'employees', v_employees),
    'Added from the attendance approval queue.', p_ip);

  RETURN jsonb_build_object(
    'ok', true,
    'network_id', v_net_id,
    'ip', p_ip::text,
    'punches_approved', v_approved,
    'employees_affected', v_employees);
END;
$$;

REVOKE ALL ON FUNCTION public.hr_allowlist_network(inet, text, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_allowlist_network(inet, text, text, boolean, text) TO authenticated;

COMMENT ON FUNCTION public.hr_allowlist_network(inet, text, text, boolean, text) IS
  'Allowlist an office address and clear the punches held from it, in one transaction. Admin/HR only.';