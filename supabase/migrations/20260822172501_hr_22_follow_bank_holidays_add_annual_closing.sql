-- =============================================================================
-- Niyom follows BANK holidays, not government-office holidays.
--
-- That inverts the call made when the 2026 calendar was loaded: 01 April,
-- "Annual Closing of Accounts", was deliberately left out on the reasoning that
-- a distributor is not a bank. Niyom does follow the bank calendar, so it is an
-- office holiday and goes in.
--
-- WHAT ELSE CHANGES: nothing, and that is the finding rather than an omission.
-- Checked against three independent reproductions of the Chennai Negotiable
-- Instruments Act list; every other 2026 date already loaded matches. A fourth
-- source disagreed on nine dates -- the whole Pongal cluster and the whole
-- Dussehra cluster each shifted a day, and Milad-un-Nabi on the 25th rather
-- than the 26th -- and is outvoted three to one on every one of them. It is
-- recorded here because "we checked and it agrees" is worth as much as a diff:
-- the next person to notice that outlier should not have to redo this.
--
-- THE WEEKLY PATTERN ALREADY MATCHES. Banks close on all Sundays plus the 2nd
-- and 4th Saturday; the default work schedule is exactly Sunday off with
-- saturday_rule = '2nd_4th'. No change needed, and none made -- editing the
-- schedule would silently rewrite working-day counts for every past month.
--
-- STILL OPEN, and deliberately not guessed: one source lists a THIRD Dussehra
-- day (21 Oct) on top of the 19th and 20th already loaded. It could not be
-- corroborated, and inventing a paid holiday is as costly as missing one, so it
-- is left out pending confirmation against Niyom's own bank's calendar.
-- =============================================================================

INSERT INTO public.hr_holidays
  (name, holiday_date, holiday_type, location, paid, auto_applies, active, description)
VALUES
  ('Annual Closing of Accounts', DATE '2026-04-01', 'public', 'Chennai', true, true, true,
   'Bank holiday under the Negotiable Instruments Act. Niyom follows the bank calendar, so the office is closed. Salary transfers cannot settle on this date either.')
ON CONFLICT (holiday_date, location, name) DO NOTHING;

DO $$
DECLARE v_count int; v_dow int;
BEGIN
  v_dow := extract(isodow FROM DATE '2026-04-01')::int;
  IF v_dow <> 3 THEN
    RAISE EXCEPTION '01 April 2026 should be a Wednesday, got day %.', v_dow;
  END IF;

  SELECT count(*) INTO v_count
  FROM hr_holidays
  WHERE location = 'Chennai' AND active
    AND holiday_date BETWEEN DATE '2026-01-01' AND DATE '2026-12-31';

  IF v_count <> 24 THEN
    RAISE EXCEPTION
      'Expected 24 Chennai holidays for 2026 after adding the bank closing day, found %.', v_count;
  END IF;
END $$;