-- =============================================================================
-- The punch decision moves from network to location.
--
-- Coordinates necessarily come FROM the client -- there is no other source of a
-- GPS fix. So the client is treated as an untrusted reporter, and everything
-- that can be decided by the server is:
--
--   * whether the reported point is inside the geofence  -- server (Haversine)
--   * whether the fix is accurate enough to mean anything -- server
--   * when the punch happened                             -- server clock
--   * who is punching                                     -- session, not payload
--   * whether it is a duplicate, out of sequence, too fast -- server
--   * whether the implied travel since the last punch is possible -- server
--
-- WHAT THIS HONESTLY DOES NOT STOP: a determined employee can override
-- coordinates in browser developer tools. No web platform prevents that, and
-- claiming otherwise would be worse than the gap. What the design does is make
-- it deliberate rather than casual, recorded rather than invisible, and
-- checkable after the fact -- every punch keeps its coordinates, accuracy,
-- distance, IP and device, and an impossible jump between two punches is
-- flagged for review.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.hr_record_punch(
  p_employee_id   uuid,
  p_punch_type    text,
  p_detected_ip   inet,
  p_forwarded_for text    DEFAULT '',
  p_user_agent    text    DEFAULT '',
  p_source        text    DEFAULT 'web',
  p_latitude      numeric DEFAULT NULL,
  p_longitude     numeric DEFAULT NULL,
  p_accuracy_m    numeric DEFAULT NULL,
  p_is_mock       boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s              record;
  prof           record;
  v_now          timestamptz := clock_timestamp();
  v_date         date;
  v_network_id   uuid;
  v_network_name text := '';
  v_net_status   text;
  v_approval     text;
  v_last         record;
  v_recent       integer;
  v_today_count  integer;
  v_punch_id     uuid;

  v_office       record;
  v_loc_status   text := NULL;
  v_distance     numeric := NULL;
  v_office_id    uuid := NULL;
  v_method       text := 'none';
  v_has_office   boolean;
  v_speed        numeric;
  v_hours        numeric;
  v_flag         text := '';
BEGIN
  v_date := hr_ist_date(v_now);

  IF p_punch_type NOT IN ('in', 'out') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_TYPE', 'message', 'Unknown punch type.');
  END IF;

  SELECT * INTO s FROM hr_attendance_settings WHERE id = 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_CONFIGURED',
      'message', 'Attendance has not been set up yet. Please contact HR.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_employee_id::text, 42));

  SELECT e.status,
         COALESCE(pr.network_exempt, false)       AS location_exempt,
         COALESCE(pr.employment_status, 'active') AS employment_status,
         pr.exit_date, pr.work_schedule_id,
         COALESCE(pr.holiday_location, 'Chennai') AS holiday_location
    INTO prof
  FROM nw_employees e
  LEFT JOIN hr_employee_profiles pr ON pr.employee_id = e.id
  WHERE e.id = p_employee_id;

  IF NOT FOUND OR prof.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INACTIVE',
      'message', 'Your employee record is not active. Please contact HR.');
  END IF;

  IF prof.exit_date IS NOT NULL AND v_date > prof.exit_date THEN
    RETURN jsonb_build_object('ok', false, 'code', 'EXITED',
      'message', 'Attendance is closed for this employee record.');
  END IF;

  -- ---- Permitted hours (unchanged) --------------------------------------
  IF p_punch_type = 'in' OR NOT s.allow_out_punch_anytime THEN
    IF NOT hr_within_punch_window(v_now) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'OUTSIDE_HOURS',
        'message', format(
          'Attendance can only be punched between %s and %s. If you are working outside these hours, ask an administrator to record it as an attendance correction.',
          to_char(s.punch_window_start, 'FMHH12:MI AM'), to_char(s.punch_window_end, 'FMHH12:MI AM')));
    END IF;
    IF s.block_on_weekly_off AND hr_is_weekly_off(prof.work_schedule_id, v_date) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'WEEKLY_OFF',
        'message', 'Today is a weekly off, so attendance cannot be punched. Ask an administrator if you are working today.');
    END IF;
    IF s.block_on_holiday AND hr_is_holiday(prof.holiday_location, v_date) IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'HOLIDAY',
        'message', 'Today is a holiday, so attendance cannot be punched. Ask an administrator if you are working today.');
    END IF;
  END IF;

  -- ---- WHERE: the decision -----------------------------------------------
  SELECT EXISTS (SELECT 1 FROM hr_office_locations WHERE status = 'active') INTO v_has_office;

  IF s.location_mode = 'off' THEN
    v_loc_status := NULL;
  ELSIF NOT v_has_office THEN
    -- Enforcing a geofence that has not been drawn would refuse everyone for a
    -- reason no employee can act on. Record it and let the punch through; the
    -- admin screen says loudly that no office is configured.
    v_loc_status := 'not_configured';
  ELSIF p_latitude IS NULL OR p_longitude IS NULL THEN
    v_loc_status := 'unavailable';
  ELSIF s.reject_mock_location AND COALESCE(p_is_mock, false) THEN
    v_loc_status := 'mock';
  ELSIF p_accuracy_m IS NOT NULL AND p_accuracy_m > s.max_accuracy_metres THEN
    -- A fix accurate to half a kilometre cannot answer a 100 m question either
    -- way, so it is neither accepted nor treated as being outside.
    v_loc_status := 'inaccurate';
  ELSE
    SELECT * INTO v_office FROM hr_nearest_office(p_latitude, p_longitude);
    IF FOUND THEN
      v_distance   := v_office.distance_m;
      v_office_id  := v_office.office_id;
      v_loc_status := CASE WHEN v_office.inside THEN 'inside' ELSE 'outside' END;
    ELSE
      v_loc_status := 'not_configured';
    END IF;
  END IF;

  -- Refusals, in enforce mode only. Each says what to do next.
  IF s.location_mode = 'enforce' AND NOT prof.location_exempt THEN
    IF v_loc_status = 'unavailable' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'LOCATION_REQUIRED',
        'message', 'Attendance needs your location. Allow location access for this site and try again. If you have blocked it, enable it in your browser settings for this page.');
    ELSIF v_loc_status = 'inaccurate' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'LOCATION_INACCURATE',
        'accuracy_m', p_accuracy_m,
        'message', format('Your location is only accurate to about %s metres, which is not precise enough to confirm you are at the office. Move near a window or step outside and try again.', round(p_accuracy_m)));
    ELSIF v_loc_status = 'mock' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'LOCATION_MOCK',
        'message', 'Your device is reporting a simulated location. Turn off any mock-location or location-spoofing setting and try again.');
    ELSIF v_loc_status = 'outside' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'OUTSIDE_OFFICE',
        'distance_m', v_distance,
        'message', format('Attendance can only be marked from the Niyom office. You are approximately %s metres away.',
                          CASE WHEN v_distance >= 1000
                               THEN round(v_distance / 1000, 1)::text || ' km'
                               ELSE round(v_distance)::text END));
    END IF;
  END IF;

  -- ---- Network: audit, and corroboration at most -------------------------
  IF p_detected_ip IS NULL THEN
    v_net_status := 'unknown';
  ELSE
    v_network_id := hr_match_network(p_detected_ip);
    IF v_network_id IS NOT NULL THEN
      SELECT name INTO v_network_name FROM hr_allowed_networks WHERE id = v_network_id;
      v_net_status := 'office';
    ELSE
      v_net_status := 'off_network';
    END IF;
  END IF;

  v_method := CASE
    WHEN v_loc_status IN ('inside', 'outside') AND v_net_status = 'office' THEN 'gps+network'
    WHEN v_loc_status IN ('inside', 'outside')                             THEN 'gps'
    WHEN s.location_mode = 'off'                                           THEN 'network'
    ELSE 'none' END;

  -- Approval now follows LOCATION. The network no longer decides anything; it
  -- is kept on the row as evidence.
  IF s.location_mode = 'enforce' AND NOT prof.location_exempt THEN
    v_approval := CASE WHEN v_loc_status IN ('inside', 'not_configured')
                       THEN 'auto_approved' ELSE 'pending' END;
  ELSE
    v_approval := 'auto_approved';
  END IF;

  -- ---- Abuse control (unchanged) -----------------------------------------
  SELECT count(*) INTO v_recent FROM hr_attendance_punches
   WHERE employee_id = p_employee_id AND punched_at > v_now - interval '1 minute';
  IF v_recent >= s.rate_limit_per_minute THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMIT',
      'message', 'Too many attempts. Please wait a moment and try again.');
  END IF;

  SELECT count(*) INTO v_today_count FROM hr_attendance_punches
   WHERE employee_id = p_employee_id AND work_date = v_date;
  IF v_today_count >= s.max_punches_per_day THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TOO_MANY',
      'message', 'You have reached the maximum number of punches for today. Please contact HR.');
  END IF;

  SELECT punch_type, punched_at, latitude, longitude INTO v_last
  FROM hr_attendance_punches
  WHERE employee_id = p_employee_id AND work_date = v_date AND approval_status <> 'rejected'
  ORDER BY punched_at DESC LIMIT 1;

  IF FOUND AND s.punch_cooldown_seconds > 0
     AND v_now - v_last.punched_at < make_interval(secs => s.punch_cooldown_seconds) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'COOLDOWN',
      'message', 'This attendance punch has already been recorded. Please refresh the page and try again.');
  END IF;

  IF p_punch_type = 'in' AND FOUND AND v_last.punch_type = 'in' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_IN',
      'message', 'You are already punched in. Punch out first.');
  END IF;

  IF p_punch_type = 'out' AND (NOT FOUND OR v_last.punch_type = 'out') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_IN',
      'message', 'You have not punched in yet today.');
  END IF;

  -- ---- Impossible travel --------------------------------------------------
  -- Cheap corroboration: a phone cannot cross a continent between two punches.
  -- Flags rather than refuses -- a legitimate first fix can be wildly wrong,
  -- and refusing on it would strand people for a signal that is only advisory.
  IF FOUND AND v_last.latitude IS NOT NULL AND p_latitude IS NOT NULL THEN
    v_hours := GREATEST(EXTRACT(EPOCH FROM (v_now - v_last.punched_at)) / 3600.0, 0.0028);
    v_speed := (hr_distance_metres(v_last.latitude, v_last.longitude, p_latitude, p_longitude) / 1000.0) / v_hours;
    IF v_speed > s.max_plausible_speed_kmh THEN
      v_flag := format('Implied travel of %s km/h since the previous punch.', round(v_speed));
    END IF;
  END IF;

  -- ---- Record -------------------------------------------------------------
  INSERT INTO hr_attendance_punches (
    employee_id, punch_type, punched_at, work_date,
    detected_ip, forwarded_for, network_id, network_name, network_status,
    approval_status, user_agent, source, enforcement_mode,
    latitude, longitude, gps_accuracy_m, distance_m, office_location_id,
    location_status, is_mock_location, verification_method, review_note)
  VALUES (
    p_employee_id, p_punch_type, v_now, v_date,
    p_detected_ip, left(COALESCE(p_forwarded_for, ''), 500), v_network_id,
    COALESCE(v_network_name, ''), v_net_status,
    v_approval, left(COALESCE(p_user_agent, ''), 300), COALESCE(p_source, 'web'),
    s.location_mode,
    p_latitude, p_longitude, p_accuracy_m, v_distance, v_office_id,
    v_loc_status, p_is_mock, v_method, v_flag)
  RETURNING id INTO v_punch_id;

  PERFORM hr_recompute_daily(p_employee_id, v_date);

  INSERT INTO hr_audit_logs (actor_employee_id, actor_name, actor_role, entity, entity_id,
                             action, after_value, ip, user_agent)
  SELECT p_employee_id, e.full_name, e.role, 'attendance', v_punch_id,
         'punch_' || p_punch_type,
         jsonb_strip_nulls(jsonb_build_object(
           'location_status', v_loc_status, 'distance_m', v_distance,
           'accuracy_m', p_accuracy_m, 'method', v_method,
           'network_status', v_net_status, 'approval', v_approval,
           'mode', s.location_mode, 'flag', NULLIF(v_flag, ''))),
         p_detected_ip, left(COALESCE(p_user_agent, ''), 300)
  FROM nw_employees e WHERE e.id = p_employee_id;

  RETURN jsonb_build_object(
    'ok', true,
    'punch_id', v_punch_id,
    'punch_type', p_punch_type,
    'punched_at', v_now,
    'work_date', v_date,
    'location_status', v_loc_status,
    'distance_m', v_distance,
    'approval_status', v_approval,
    'verification_method', v_method,
    'message', CASE
      WHEN v_approval = 'pending'
        THEN 'Recorded, but we could not confirm you are at the office. This punch needs admin approval before it counts.'
      WHEN p_punch_type = 'in'  THEN 'Punched in.'
      ELSE 'Punched out.'
    END);
END;
$$;

-- The old six-argument form is superseded.
DROP FUNCTION IF EXISTS public.hr_record_punch(uuid, text, inet, text, text, text);

REVOKE ALL ON FUNCTION public.hr_record_punch(uuid, text, inet, text, text, text, numeric, numeric, numeric, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hr_record_punch(uuid, text, inet, text, text, text, numeric, numeric, numeric, boolean)
  TO service_role;
