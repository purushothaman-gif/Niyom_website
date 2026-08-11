/*
  Hand a claimed slot back without consuming a retry attempt.

  mkt_auto_finish_slot increments regen_count because it records the outcome of
  an ATTEMPT. Two paths release a slot having never called the model at all — a
  dry run, and deferral past the invocation deadline — and using finish_slot for
  those burned the retry budget for work that was never done. Three dry runs in
  a row would have left the day permanently unable to generate.
*/
CREATE OR REPLACE FUNCTION mkt_auto_release_slot(p_slot_id uuid, p_note text DEFAULT '')
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE mkt_auto_slots
  SET state = 'planned', error = COALESCE(p_note, '')
  WHERE id = p_slot_id;
END;
$$;

REVOKE ALL ON FUNCTION mkt_auto_release_slot(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mkt_auto_release_slot(uuid, text) TO service_role;

-- Undo the attempt the dry run consumed while proving this bug.
UPDATE mkt_auto_slots SET regen_count = 0, error = ''
WHERE run_date = DATE '2026-08-11' AND state = 'planned';
