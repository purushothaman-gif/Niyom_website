-- =============================================================================
-- Attendance moves from "which network are you on" to "where are you".
--
-- WHY. The public IP was never a location check. It identified the ISP's edge,
-- it rotated, and it demanded an approval every time it did. Worse, when the
-- proxy-hop setting was wrong it was reading the platform's own load balancer,
-- which meant the restriction silently applied to nobody. Coordinates answer
-- the question that was actually being asked: is this person at the office.
--
-- ENTIRELY ADDITIVE. Every column here is nullable and every table is new, so
-- the 28 existing punches, 700 daily rows and 15 payroll records keep working
-- untouched and keep their meaning: a punch with no coordinates is one made
-- before location verification existed, which is exactly what it was.
--
-- THE IP IS NOT DELETED, IT IS DEMOTED. detected_ip and forwarded_for stay on
-- every punch as an audit trail and as a corroborating signal. They stop being
-- the eligibility decision.
-- =============================================================================

-- --- Where the office is ----------------------------------------------------
-- A table rather than two settings columns, for the same reason
-- hr_allowed_networks is a table: a second office, or a temporary site, should
-- not need a schema change. No coordinates are seeded -- inventing them would
-- put a geofence somewhere nobody works.

CREATE TABLE public.hr_office_locations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  address        text NOT NULL DEFAULT '',
  latitude       numeric(9,6)  NOT NULL CHECK (latitude  BETWEEN -90  AND 90),
  longitude      numeric(9,6)  NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  -- Metres. 100 is a sensible default for a city office: large enough to
  -- absorb ordinary GPS error indoors, small enough to exclude the next
  -- building. Configurable because that trade-off is site-specific.
  radius_metres  integer NOT NULL DEFAULT 100 CHECK (radius_metres BETWEEN 20 AND 5000),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to   date,
  description    text NOT NULL DEFAULT '',
  created_by     uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  -- 0,0 is in the Atlantic. It is what an uninitialised coordinate looks like,
  -- and a geofence there would reject everyone with no obvious cause.
  CHECK (NOT (latitude = 0 AND longitude = 0))
);

CREATE INDEX hr_office_locations_active_idx ON public.hr_office_locations (status)
  WHERE status = 'active';

CREATE TRIGGER hr_office_locations_touch BEFORE UPDATE ON public.hr_office_locations
  FOR EACH ROW EXECUTE FUNCTION public.hr_touch_updated_at();

COMMENT ON TABLE public.hr_office_locations IS
  'Office geofences. Readable by HR only -- an employee is told whether they are inside and roughly how far away, never the coordinates or the radius.';

-- --- What the punch recorded about where it was made ------------------------

ALTER TABLE public.hr_attendance_punches
  ADD COLUMN IF NOT EXISTS latitude          numeric(9,6),
  ADD COLUMN IF NOT EXISTS longitude         numeric(9,6),
  ADD COLUMN IF NOT EXISTS gps_accuracy_m    numeric(8,2),
  ADD COLUMN IF NOT EXISTS distance_m        numeric(10,2),
  ADD COLUMN IF NOT EXISTS office_location_id uuid REFERENCES public.hr_office_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS location_status   text
      CHECK (location_status IS NULL OR location_status IN
             ('inside', 'outside', 'unavailable', 'inaccurate', 'not_configured', 'mock')),
  ADD COLUMN IF NOT EXISTS is_mock_location  boolean,
  ADD COLUMN IF NOT EXISTS verification_method text NOT NULL DEFAULT 'none';

COMMENT ON COLUMN public.hr_attendance_punches.verification_method IS
  'How this punch was verified: gps, gps+network, network (legacy), or none. Legacy punches predate location verification and say so.';
COMMENT ON COLUMN public.hr_attendance_punches.is_mock_location IS
  'Reported by the client where the platform can tell (native Android). NULL means unknown -- a browser cannot detect it, and treating unknown as fraud would make the web unusable.';

-- Existing rows: say plainly what they were, rather than leaving them looking
-- like location checks that failed.
UPDATE public.hr_attendance_punches
   SET verification_method = 'network'
 WHERE verification_method = 'none';

CREATE INDEX hr_punches_location_idx ON public.hr_attendance_punches (location_status)
  WHERE location_status IS NOT NULL;

-- --- Settings ---------------------------------------------------------------

ALTER TABLE public.hr_attendance_settings
  -- off      : coordinates recorded if sent, never required, never blocking
  -- observe  : recorded and shown, still never blocking (the safe rollout)
  -- enforce  : outside the geofence is refused
  ADD COLUMN IF NOT EXISTS location_mode text NOT NULL DEFAULT 'off'
      CHECK (location_mode IN ('off', 'observe', 'enforce')),
  -- A fix accurate only to half a kilometre cannot answer a 100 m question.
  -- Rejected rather than accepted-and-hoped, but generously, because indoor
  -- fixes are genuinely poor.
  ADD COLUMN IF NOT EXISTS max_accuracy_metres integer NOT NULL DEFAULT 150
      CHECK (max_accuracy_metres BETWEEN 20 AND 2000),
  ADD COLUMN IF NOT EXISTS require_gps boolean NOT NULL DEFAULT true,
  -- The network check survives only as corroboration, never as the decision.
  ADD COLUMN IF NOT EXISTS network_check text NOT NULL DEFAULT 'audit'
      CHECK (network_check IN ('audit', 'corroborate')),
  -- Consecutive punches implying travel faster than this are flagged. A cheap
  -- signal against a spoofed coordinate: a phone cannot be in two cities an
  -- hour apart.
  ADD COLUMN IF NOT EXISTS max_plausible_speed_kmh integer NOT NULL DEFAULT 900
      CHECK (max_plausible_speed_kmh BETWEEN 50 AND 5000),
  ADD COLUMN IF NOT EXISTS reject_mock_location boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.hr_attendance_settings.location_mode IS
  'off | observe | enforce. Ships as off so nothing changes until an office location is configured; observe records and shows without blocking.';
COMMENT ON COLUMN public.hr_attendance_settings.network_check IS
  'audit = the IP is recorded and never affects eligibility. corroborate = a punch from a known office network is noted as additional evidence, but location still decides.';

-- --- Distance ---------------------------------------------------------------
-- Haversine, in SQL, because the decision has to be the server's. No extension:
-- earthdistance would pull in cube for one formula that is four lines long.

CREATE OR REPLACE FUNCTION public.hr_distance_metres(
  lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT round((
    6371000 * 2 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) *
      power(sin(radians(lon2 - lon1) / 2), 2)
    ))
  )::numeric, 2);
$$;

COMMENT ON FUNCTION public.hr_distance_metres(numeric, numeric, numeric, numeric) IS
  'Great-circle distance in metres (Haversine, mean Earth radius). Accurate to well within a metre at office scale.';

-- Nearest active office and the distance to it. Returns the closest even when
-- outside every radius, so the employee can be told how far away they are.
CREATE OR REPLACE FUNCTION public.hr_nearest_office(p_lat numeric, p_lon numeric)
RETURNS TABLE (office_id uuid, office_name text, distance_m numeric, radius_m integer, inside boolean)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT o.id, o.name,
         hr_distance_metres(p_lat, p_lon, o.latitude, o.longitude),
         o.radius_metres,
         hr_distance_metres(p_lat, p_lon, o.latitude, o.longitude) <= o.radius_metres
  FROM hr_office_locations o
  WHERE o.status = 'active'
    AND o.effective_from <= hr_today()
    AND (o.effective_to IS NULL OR o.effective_to >= hr_today())
    AND p_lat IS NOT NULL AND p_lon IS NOT NULL
  ORDER BY hr_distance_metres(p_lat, p_lon, o.latitude, o.longitude)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.hr_distance_metres(numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_nearest_office(numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hr_distance_metres(numeric, numeric, numeric, numeric) TO authenticated;

-- --- RLS --------------------------------------------------------------------
-- Same shape as hr_allowed_networks: HR reads and writes, employees never see
-- the geofence itself. Knowing the exact centre and radius is what you would
-- need to fake a position convincingly.

ALTER TABLE public.hr_office_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY hr_office_locations_read ON public.hr_office_locations
  FOR SELECT TO authenticated USING ((SELECT hr_can_view('attendance')));

CREATE POLICY hr_office_locations_write ON public.hr_office_locations
  FOR ALL TO authenticated
  USING ((SELECT hr_can_edit('attendance'))) WITH CHECK ((SELECT hr_can_edit('attendance')));
