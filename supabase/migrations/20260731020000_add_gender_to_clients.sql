/*
  # Add gender to nw_clients

  BSE StAR MF's add_ucc requires a gender for the primary holder. It was the one
  field the MF Admin console could not source when importing a client from the
  CRM, forcing it to be re-typed on every registration.

  Nullable, so existing rows and any flow that saves a client before gender is
  known keep working. Constrained to the three codes BSE accepts.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'nw_clients' AND column_name = 'gender'
  ) THEN
    ALTER TABLE nw_clients ADD COLUMN gender text;
    COMMENT ON COLUMN nw_clients.gender IS
      'M | F | O — required by BSE StAR MF add_ucc for the primary holder.';
  END IF;
END $$;

ALTER TABLE nw_clients DROP CONSTRAINT IF EXISTS nw_clients_gender_check;
ALTER TABLE nw_clients ADD CONSTRAINT nw_clients_gender_check
  CHECK (gender IS NULL OR gender IN ('M', 'F', 'O'));
