/*
  # Lead Management — two engagement statuses for the Call Queue

  The call queue lets an employee record what a call led to. Beyond the existing
  pipeline stages, they need "WhatsApp Sent" and "Email Sent" dispositions.
  Widen the nw_leads.status CHECK to allow them (purely additive — no existing
  value is removed, so every current row stays valid) and give them a score
  weight so an engaged lead isn't scored as dead.
*/

ALTER TABLE nw_leads DROP CONSTRAINT IF EXISTS nw_leads_status_check;
ALTER TABLE nw_leads ADD CONSTRAINT nw_leads_status_check CHECK (status IN (
  'New','Assigned','Attempted','Connected','Interested',
  'Meeting Scheduled','Follow-up','WhatsApp Sent','Email Sent',
  'Documentation Pending','KYC Pending','Investment Under Process','Waiting for Client',
  'No Response','Call Back Later','Wrong Number','Not Interested',
  'Lost','Closed - Converted','Closed - Rejected'
));

CREATE OR REPLACE FUNCTION nw_lead_score_for(
  p_investment_capacity numeric, p_annual_income numeric,
  p_priority text, p_status text
) RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s int := 0; cap numeric := COALESCE(p_investment_capacity, p_annual_income, 0);
BEGIN
  IF    cap >= 10000000 THEN s := s + 45;
  ELSIF cap >=  5000000 THEN s := s + 38;
  ELSIF cap >=  2500000 THEN s := s + 30;
  ELSIF cap >=  1000000 THEN s := s + 22;
  ELSIF cap >=   500000 THEN s := s + 14;
  ELSIF cap >        0  THEN s := s + 7;
  END IF;
  s := s + CASE p_priority WHEN 'urgent' THEN 20 WHEN 'high' THEN 15 WHEN 'medium' THEN 8 ELSE 3 END;
  s := s + CASE p_status
    WHEN 'Closed - Converted' THEN 35 WHEN 'Investment Under Process' THEN 32
    WHEN 'KYC Pending' THEN 30 WHEN 'Documentation Pending' THEN 28
    WHEN 'Meeting Scheduled' THEN 26 WHEN 'Interested' THEN 24
    WHEN 'Connected' THEN 18 WHEN 'Follow-up' THEN 16
    WHEN 'WhatsApp Sent' THEN 16 WHEN 'Email Sent' THEN 14
    WHEN 'Call Back Later' THEN 14 WHEN 'Waiting for Client' THEN 14
    WHEN 'Attempted' THEN 8 WHEN 'Assigned' THEN 6
    WHEN 'New' THEN 4 WHEN 'No Response' THEN 2
    ELSE 0
  END;
  RETURN LEAST(s, 100);
END;
$$;
