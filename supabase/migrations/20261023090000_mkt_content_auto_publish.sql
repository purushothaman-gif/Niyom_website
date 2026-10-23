-- Marketing content goes live on creation. No approval step.
--
-- The module shipped with an admin approval queue: content was created as
-- 'draft' and stayed invisible to employees until an admin pressed Approve.
-- In practice nobody ever did — every one of the 39 items generated between
-- 2026-09-04 and 2026-10-12 was still sitting in the queue, so the auto content
-- engine had been running three times a day into a room nobody entered. A gate
-- nobody passes through is not a control, it is just an off switch.
--
-- The trigger (rather than a column DEFAULT) is deliberate: expires_at is
-- derived from scheduled_publish_at ON THE SAME ROW, which a DEFAULT cannot
-- reference. It also means every insert path is covered at once — the Content
-- Studio, the mkt-auto-generate cron, and anything added later — instead of
-- each caller remembering to publish itself.
--
-- The 48-hour expiry is unchanged and still computed on the server clock, so
-- content remains deliberately short-lived; it now simply starts its 48 hours
-- at creation instead of at approval.
--
-- Admins keep archive and delete. That is takedown, not approval: it is the
-- path for pulling something that should not have gone out, and removing it
-- would leave no way to do that.

CREATE OR REPLACE FUNCTION public.mkt_content_auto_publish()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  /*
   * Only ever acts on a fresh row. An insert that explicitly asks for
   * 'archived' or 'rejected' (a restore, a backfill, a future import) is left
   * alone — this publishes what would otherwise have waited, it does not
   * overrule a decision someone made on purpose.
   */
  IF NEW.status IS NULL OR NEW.status = 'draft' THEN
    NEW.status := 'approved';

    -- approved_by stays NULL: nobody approved it. The audit trail should not
    -- claim a person reviewed something no person looked at.
    NEW.approved_at := now();

    NEW.expires_at := greatest(now(), COALESCE(NEW.scheduled_publish_at, now()))
                      + interval '48 hours';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_mkt_content_auto_publish ON mkt_content;

CREATE TRIGGER trg_mkt_content_auto_publish
  BEFORE INSERT ON mkt_content
  FOR EACH ROW
  EXECUTE FUNCTION public.mkt_content_auto_publish();
