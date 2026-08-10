-- One-off data backfill (applied via the migration API on 2026-08-10).
-- The sign-debit-note bug (metadata null in a bulk insert) had dropped every
-- signing audit event, so all 14 already-signed notes had no otp_verified /
-- signed / signed_pdf_stored events. Reconstructed from each note's own stored
-- signing columns, stamped at the real signed_at, flagged backfilled:true so
-- they are never mistaken for original live events. Idempotent (NOT EXISTS).
insert into dsa_debit_note_events (debit_note_id, event_type, actor, metadata, ip, user_agent, created_at)
select n.id, 'otp_verified', 'dsa', jsonb_build_object('backfilled', true), n.signer_ip, n.signer_user_agent, n.signed_at
from dsa_debit_notes n
where (n.signature_status = 'signed' or n.signed_at is not null)
  and not exists (select 1 from dsa_debit_note_events e where e.debit_note_id = n.id and e.event_type = 'otp_verified');

insert into dsa_debit_note_events (debit_note_id, event_type, actor, metadata, ip, user_agent, created_at)
select n.id, 'signed', 'dsa', jsonb_build_object('signer_email', n.signer_email, 'backfilled', true),
       n.signer_ip, n.signer_user_agent, n.signed_at
from dsa_debit_notes n
where (n.signature_status = 'signed' or n.signed_at is not null)
  and not exists (select 1 from dsa_debit_note_events e where e.debit_note_id = n.id and e.event_type = 'signed');

insert into dsa_debit_note_events (debit_note_id, event_type, actor, metadata, created_at)
select n.id, 'signed_pdf_stored', 'system',
       jsonb_build_object('signed_pdf_url', n.signed_pdf_url, 'signature_image_path', n.signature_image_path, 'backfilled', true),
       n.signed_at
from dsa_debit_notes n
where (n.signature_status = 'signed' or n.signed_at is not null)
  and not exists (select 1 from dsa_debit_note_events e where e.debit_note_id = n.id and e.event_type = 'signed_pdf_stored');
