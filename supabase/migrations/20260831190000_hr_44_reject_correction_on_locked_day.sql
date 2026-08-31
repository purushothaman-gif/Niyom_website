-- =============================================================================
-- Rejecting an attendance correction stops needing a payroll reopened.
--
-- hr_10 refused BOTH decisions on a day locked by a finalised payroll. Blocking
-- an approval is right -- it would rewrite a day that has already been paid.
-- Blocking a rejection is not: rejecting leaves the day exactly as it stands
-- and only records that the request was considered and declined.
--
-- The cost of getting that wrong is worse than an inconvenience. To clear a
-- request they had decided against, an administrator had to reopen a locked
-- payroll -- unlocking every day of the month and re-running approval -- in
-- order to change nothing at all. The safe action was the one the system made
-- difficult, which is how people learn to reopen payrolls casually.
--
-- Approval stays blocked, and its message now names rejection as the way out
-- when the correction is not actually needed.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.hr_review_adjustment(
  p_adjustment_id uuid, p_approve boolean, p_note text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_a record; v_before jsonb;
BEGIN
  IF NOT hr_can_edit('attendance') THEN
    RAISE EXCEPTION 'You do not have permission to review attendance corrections.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_a FROM hr_attendance_adjustments WHERE id = p_adjustment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Correction request not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_a.status <> 'pending' THEN
    RAISE EXCEPTION 'This correction has already been reviewed.' USING ERRCODE = 'check_violation';
  END IF;

  /*
   * A locked day blocks APPROVING a correction, because approving rewrites the
   * day and the day has already been paid. It does not block REJECTING one:
   * rejecting leaves attendance exactly as it stands and only marks the request
   * dealt with.
   *
   * The guard used to cover both, which left an administrator unable to clear a
   * request they had decided against without reopening a finalised payroll --
   * an alarming, audited operation to perform in order to change nothing. It
   * came up the first time it could: five people filed corrections for punches
   * that had actually recorded, and every one of them was stuck behind a lock
   * protecting figures none of the rejections would have touched.
   */
  IF p_approve AND EXISTS (SELECT 1 FROM hr_attendance_daily
              WHERE employee_id = v_a.employee_id AND work_date = v_a.work_date AND locked) THEN
    RAISE EXCEPTION
      'Attendance for % is locked by a finalised payroll, so this correction cannot be approved. Reopen that payroll first, or reject the request if it is not needed.', v_a.work_date
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Capture the day exactly as it stood, so the audit row shows what changed.
  SELECT to_jsonb(d) INTO v_before FROM hr_attendance_daily d
   WHERE d.employee_id = v_a.employee_id AND d.work_date = v_a.work_date;

  UPDATE hr_attendance_adjustments
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         reviewed_by = nw_current_employee_id(), reviewed_at = now(),
         review_note = COALESCE(p_note, ''),
         before_value = COALESCE(v_before, '{}'::jsonb)
   WHERE id = p_adjustment_id;

  PERFORM hr_recompute_daily(v_a.employee_id, v_a.work_date);

  UPDATE hr_attendance_adjustments a
     SET after_value = COALESCE((SELECT to_jsonb(d) FROM hr_attendance_daily d
                                  WHERE d.employee_id = a.employee_id AND d.work_date = a.work_date),
                                '{}'::jsonb)
   WHERE a.id = p_adjustment_id;

  PERFORM hr_audit('attendance', p_adjustment_id,
    CASE WHEN p_approve THEN 'correction_approved' ELSE 'correction_rejected' END,
    COALESCE(v_before, '{}'::jsonb),
    COALESCE((SELECT to_jsonb(d) FROM hr_attendance_daily d
               WHERE d.employee_id = v_a.employee_id AND d.work_date = v_a.work_date), '{}'::jsonb),
    COALESCE(p_note, ''));

  RETURN jsonb_build_object('ok', true);
END;
$$;
