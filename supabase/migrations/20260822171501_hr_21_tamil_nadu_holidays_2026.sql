-- =============================================================================
-- Tamil Nadu public holidays, 2026 (Chennai).
--
-- The 23 days the office is closed, from the Tamil Nadu Government's 2026
-- public holiday notification. Cross-checked against two independent
-- reproductions of the notification, which agree on every date.
--
-- DELIBERATELY EXCLUDED: 01 April 2026, "Annual Closing of Accounts". That is a
-- BANK holiday under the Negotiable Instruments Act, not a day a distributor's
-- office closes. Adding it would hand every employee a free paid day and
-- understate working days for April. It still matters for TREASURY -- a salary
-- transfer file uploaded for 01 April will not settle -- but that is a payment
-- date to avoid, not a holiday to grant.
--
-- ISLAMIC DATES ARE PROVISIONAL. Ramzan, Bakrid, Muharram and Milad-un-Nabi
-- follow moon sighting and the state can shift them by a day. The first three
-- have already passed in 2026 and are recorded as observed; Milad-un-Nabi
-- (26 Aug) is days away at the time of writing and should be confirmed against
-- the final notification. A wrong date here costs someone a day's pay.
--
-- The three national dates already seeded are re-listed with their EXISTING
-- names so the (holiday_date, location, name) unique constraint makes them
-- no-ops. A different spelling would create a SECOND holiday row on the same
-- date -- harmless to pay, since hr_is_holiday() takes the first match, but it
-- would double-count in the calendar and the holiday totals.
--
-- The weekday assertion at the end is the point of doing this as a migration
-- rather than by hand: a transcribed date that lands on the wrong day of the
-- week is exactly the error that would otherwise surface as an unexplained
-- absence three months later.
-- =============================================================================

INSERT INTO public.hr_holidays
  (name, holiday_date, holiday_type, location, paid, auto_applies, active, description)
VALUES
  ('New Year''s Day',            DATE '2026-01-01', 'public', 'Chennai', true, true, true, ''),
  ('Pongal',                     DATE '2026-01-15', 'public', 'Chennai', true, true, true, ''),
  ('Thiruvalluvar Day',          DATE '2026-01-16', 'public', 'Chennai', true, true, true, ''),
  ('Uzhavar Thirunal',           DATE '2026-01-17', 'public', 'Chennai', true, true, true, ''),
  ('Republic Day',               DATE '2026-01-26', 'public', 'Chennai', true, true, true, ''),
  ('Thai Poosam',                DATE '2026-02-01', 'public', 'Chennai', true, true, true, ''),
  ('Telugu New Year''s Day',     DATE '2026-03-19', 'public', 'Chennai', true, true, true, ''),
  ('Ramzan (Id-ul-Fitr)',        DATE '2026-03-21', 'public', 'Chennai', true, true, true,
     'Moon-sighting dependent; date as observed in 2026.'),
  ('Mahavir Jayanti',            DATE '2026-03-31', 'public', 'Chennai', true, true, true, ''),
  ('Good Friday',                DATE '2026-04-03', 'public', 'Chennai', true, true, true, ''),
  ('Tamil New Year / Dr B.R. Ambedkar''s Birthday',
                                 DATE '2026-04-14', 'public', 'Chennai', true, true, true, ''),
  ('May Day',                    DATE '2026-05-01', 'public', 'Chennai', true, true, true, ''),
  ('Bakrid (Id-ul-Zuha)',        DATE '2026-05-28', 'public', 'Chennai', true, true, true,
     'Moon-sighting dependent; date as observed in 2026.'),
  ('Muharram',                   DATE '2026-06-26', 'public', 'Chennai', true, true, true,
     'Moon-sighting dependent; date as observed in 2026.'),
  ('Independence Day',           DATE '2026-08-15', 'public', 'Chennai', true, true, true, ''),
  ('Milad-un-Nabi',              DATE '2026-08-26', 'public', 'Chennai', true, true, true,
     'Moon-sighting dependent -- confirm against the final state notification.'),
  ('Krishna Jayanti',            DATE '2026-09-04', 'public', 'Chennai', true, true, true, ''),
  ('Vinayakar Chathurthi',       DATE '2026-09-14', 'public', 'Chennai', true, true, true, ''),
  ('Gandhi Jayanti',             DATE '2026-10-02', 'public', 'Chennai', true, true, true, ''),
  ('Ayutha Pooja',               DATE '2026-10-19', 'public', 'Chennai', true, true, true, ''),
  ('Vijaya Dasami',              DATE '2026-10-20', 'public', 'Chennai', true, true, true, ''),
  ('Deepavali',                  DATE '2026-11-08', 'public', 'Chennai', true, true, true, ''),
  ('Christmas Day',              DATE '2026-12-25', 'public', 'Chennai', true, true, true, '')
ON CONFLICT (holiday_date, location, name) DO NOTHING;

-- --- Assert each date lands on the weekday the notification says ------------
-- A transcription slip (Deepavali on the 8th vs the 9th) is invisible in a list
-- of dates but obvious in a weekday. If any pair disagrees the whole migration
-- rolls back rather than shipping a calendar that silently mis-pays someone.
DO $$
DECLARE
  expected CONSTANT text[][] := ARRAY[
    ['2026-01-01','4'], ['2026-01-15','4'], ['2026-01-16','5'], ['2026-01-17','6'],
    ['2026-01-26','1'], ['2026-02-01','7'], ['2026-03-19','4'], ['2026-03-21','6'],
    ['2026-03-31','2'], ['2026-04-03','5'], ['2026-04-14','2'], ['2026-05-01','5'],
    ['2026-05-28','4'], ['2026-06-26','5'], ['2026-08-15','6'], ['2026-08-26','3'],
    ['2026-09-04','5'], ['2026-09-14','1'], ['2026-10-02','5'], ['2026-10-19','1'],
    ['2026-10-20','2'], ['2026-11-08','7'], ['2026-12-25','5']
  ];
  i int;
  v_actual int;
  v_count int;
BEGIN
  FOR i IN 1 .. array_length(expected, 1) LOOP
    v_actual := extract(isodow FROM expected[i][1]::date)::int;
    IF v_actual <> expected[i][2]::int THEN
      RAISE EXCEPTION
        'Holiday date % is a %, but the notification records it as day %. Check the transcription.',
        expected[i][1], to_char(expected[i][1]::date, 'FMDay'), expected[i][2];
    END IF;
  END LOOP;

  SELECT count(*) INTO v_count
  FROM hr_holidays
  WHERE location = 'Chennai' AND active
    AND holiday_date BETWEEN DATE '2026-01-01' AND DATE '2026-12-31';

  IF v_count <> 23 THEN
    RAISE EXCEPTION
      'Expected 23 Chennai holidays for 2026 after this migration, found %. A duplicate or a missing row.',
      v_count;
  END IF;
END $$;