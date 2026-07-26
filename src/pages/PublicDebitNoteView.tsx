import { useCallback, useEffect, useState } from 'react';
import { LogoLoader } from '../components/LogoLoader';
import { supabase } from '../lib/supabase';
import { CheckCircle2, AlertCircle, ShieldCheck, Loader2, PenLine, Mail } from 'lucide-react';
import SignaturePad from '../components/SignaturePad';
import { buildDebitNoteHtml, generateSignedDebitNotePdfBase64, DebitNoteInput } from '../crm/dsaDebitNote';

interface Props { token: string; }

type Phase =
  | 'loading'
  | 'review'
  | 'otp-request'
  | 'otp-verify'
  | 'sign'
  | 'success'
  | 'terminal';

// The render snapshot stored on the debit note (serializable DebitNoteInput).
interface PdfSnapshot {
  debitNoteNumber: string;
  dateISO: string;
  month: number;
  year: number;
  dsa: DebitNoteInput['dsa'];
  particulars: DebitNoteInput['particulars'];
  total: number;
  tdsAmount: number;
  netPayable: number;
  generatedBy: string;
}

interface PublicNote {
  debit_note_number: string;
  month: number;
  year: number;
  payout_amount: number;
  tds_amount: number;
  net_payable_amount: number;
  signature_status: string;
  pdf_snapshot: PdfSnapshot | null;
  dsa: { full_name: string; dsa_code: string; email_masked: string };
}

function snapshotToInput(s: PdfSnapshot): DebitNoteInput {
  return {
    debitNoteNumber: s.debitNoteNumber,
    date: new Date(s.dateISO),
    month: s.month,
    year: s.year,
    dsa: s.dsa,
    particulars: s.particulars,
    total: s.total,
    tdsAmount: s.tdsAmount,
    netPayable: s.netPayable,
    generatedBy: s.generatedBy,
  };
}

const card: React.CSSProperties = { background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' };
const gold = 'linear-gradient(135deg, #D4AF37, #B8961E)';
const btnGold: React.CSSProperties = { background: gold, color: '#000', fontWeight: 700, padding: '12px 28px', borderRadius: 10, display: 'inline-flex', alignItems: 'center', gap: 8, border: 'none', cursor: 'pointer' };
const btnGhost: React.CSSProperties = { background: '#f3f4f6', color: '#374151', fontWeight: 600, padding: '12px 20px', borderRadius: 10, border: 'none', cursor: 'pointer' };

export default function PublicDebitNoteView({ token }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [note, setNote] = useState<PublicNote | null>(null);
  const [terminalReason, setTerminalReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [otp, setOtp] = useState('');
  const [signature, setSignature] = useState<string | null>(null);

  // Load note (item 1)
  useEffect(() => {
    (async () => {
      const { data, error: fnErr } = await supabase.functions.invoke('get-debit-note-by-token', { body: { token } });
      if (fnErr || !data) { setPhase('terminal'); setTerminalReason('error'); return; }
      if (!data.valid) { setPhase('terminal'); setTerminalReason(data.reason || 'invalid'); return; }
      setNote(data.note as PublicNote);
      setPhase('review');
    })();
  }, [token]);

  const maskedEmail = note?.dsa?.email_masked || 'your registered email';

  const startSign = () => {
    setOtp('');
    setSignature(null);
    setError('');
    setPhase('otp-request');
  };

  const sendCode = useCallback(async () => {
    setBusy(true); setError('');
    const { data, error: fnErr } = await supabase.functions.invoke('send-debit-note-otp', { body: { token } });
    setBusy(false);
    if (fnErr || !data?.success) { setError(data?.error || 'Could not send the verification code.'); return; }
    setOtp('');
    setPhase('otp-verify');
  }, [token]);

  const verifyCode = async () => {
    if (otp.trim().length < 6) { setError('Enter the 6-digit code sent to your email.'); return; }
    setBusy(true); setError('');
    const { data, error: fnErr } = await supabase.functions.invoke('verify-debit-note-otp', {
      body: { token, otp: otp.trim() },
    });
    setBusy(false);
    if (fnErr || !data?.verified) { setError(data?.error || 'Verification failed.'); return; }
    setPhase('sign');
  };

  // Generate signed PDF from the stored snapshot + signature, then finalize.
  const confirmSign = async () => {
    if (!note) return;
    if (!note.pdf_snapshot) { setError('This debit note cannot be signed online. Please contact your relationship manager.'); return; }
    if (!signature) { setError('Please draw your signature to proceed.'); return; }
    setBusy(true); setError('');
    try {
      const input = snapshotToInput(note.pdf_snapshot);
      const signedPdfBase64 = await generateSignedDebitNotePdfBase64({
        ...input,
        clientSignatureDataUrl: signature,
        signedDate: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      });

      const { data, error: fnErr } = await supabase.functions.invoke('sign-debit-note', {
        body: { token, otp: otp.trim(), signatureBase64: signature, signedPdfBase64 },
      });
      if (fnErr || !data?.success) { setError(data?.error || 'Could not complete signing.'); setBusy(false); return; }
      setPhase('success');
    } catch (e: any) {
      setError(e?.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // ---------- Renders ----------
  if (phase === 'loading') {
    return (
      <Shell>
        <div style={{ ...card, padding: 48, textAlign: 'center' }}>
          <LogoLoader size={48} label="Loading your debit note…" />
        </div>
      </Shell>
    );
  }

  if (phase === 'terminal') {
    const map: Record<string, { title: string; msg: string; icon: JSX.Element }> = {
      invalid: { title: 'Link not valid', msg: 'This debit note link is invalid or has been replaced by an updated one.', icon: <AlertCircle style={{ width: 40, height: 40, color: '#ef4444' }} /> },
      expired: { title: 'Link expired', msg: 'This link has expired. Please contact your relationship manager for an updated link.', icon: <AlertCircle style={{ width: 40, height: 40, color: '#f59e0b' }} /> },
      signed: { title: 'Already signed', msg: 'This debit note has already been signed and is now locked.', icon: <CheckCircle2 style={{ width: 40, height: 40, color: '#10b981' }} /> },
      cancelled: { title: 'Debit note cancelled', msg: 'This debit note has been cancelled. Please contact your relationship manager.', icon: <AlertCircle style={{ width: 40, height: 40, color: '#ef4444' }} /> },
      error: { title: 'Something went wrong', msg: 'We could not load this debit note. Please try again later.', icon: <AlertCircle style={{ width: 40, height: 40, color: '#ef4444' }} /> },
    };
    const t = map[terminalReason] || map.error;
    return (
      <Shell>
        <div style={{ ...card, padding: 48, textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
          {t.icon}
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111', marginTop: 16 }}>{t.title}</h2>
          <p style={{ marginTop: 8, color: '#6b7280' }}>{t.msg}</p>
        </div>
      </Shell>
    );
  }

  if (phase === 'success') {
    return (
      <Shell>
        <div style={{ ...card, padding: 48, textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
          <CheckCircle2 style={{ width: 48, height: 48, color: '#10b981', margin: '0 auto' }} />
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#111', marginTop: 16 }}>Debit Note Signed</h2>
          <p style={{ marginTop: 8, color: '#6b7280' }}>
            Thank you. Your acknowledgement and e-signature have been recorded with Niyom Wealth.
          </p>
        </div>
      </Shell>
    );
  }

  if (!note) return null;

  const previewHtml = note.pdf_snapshot ? buildDebitNoteHtml(snapshotToInput(note.pdf_snapshot)) : '';

  return (
    <Shell>
      {/* Document preview (unsigned) */}
      <div style={{ ...card, padding: 16, overflowX: 'auto' }}>
        {previewHtml
          ? <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
          : <p style={{ color: '#6b7280', padding: 24, textAlign: 'center' }}>Preview unavailable.</p>}
      </div>

      {error && (
        <div style={{ ...card, borderColor: '#fecaca', background: '#fef2f2', padding: 14, display: 'flex', gap: 10, alignItems: 'center', marginTop: 16 }}>
          <AlertCircle style={{ width: 18, height: 18, color: '#ef4444', flexShrink: 0 }} />
          <span style={{ color: '#b91c1c', fontSize: 14 }}>{error}</span>
        </div>
      )}

      {/* Action panel */}
      <div style={{ ...card, padding: 24, marginTop: 16 }}>
        {phase === 'review' && (
          <div>
            <p style={{ color: '#374151', fontSize: 14, marginBottom: 16 }}>
              Please review the debit note above. To acknowledge it you will verify a code sent to your registered email, then add a brief electronic signature.
            </p>
            <button onClick={startSign} style={btnGold}>
              <PenLine style={{ width: 16, height: 16 }} /> Review &amp; Sign
            </button>
          </div>
        )}

        {phase === 'otp-request' && (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#111', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Mail style={{ width: 18, height: 18, color: '#B8961E' }} /> Verify your identity to sign
            </h3>
            <p style={{ color: '#6b7280', fontSize: 13, marginTop: 6 }}>
              We’ll send a 6-digit verification code to <strong>{maskedEmail}</strong>.
            </p>
            <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
              <button onClick={sendCode} disabled={busy} style={{ ...btnGold, opacity: busy ? 0.6 : 1 }}>
                {busy ? <Loader2 className="animate-spin" style={{ width: 16, height: 16 }} /> : <Mail style={{ width: 16, height: 16 }} />}
                Send Code
              </button>
              <button onClick={() => { setPhase('review'); setError(''); }} disabled={busy} style={btnGhost}>Back</button>
            </div>
          </div>
        )}

        {phase === 'otp-verify' && (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#111', display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShieldCheck style={{ width: 18, height: 18, color: '#B8961E' }} /> Enter verification code
            </h3>
            <p style={{ color: '#6b7280', fontSize: 13, marginTop: 6 }}>
              A 6-digit code was sent to <strong>{maskedEmail}</strong>.
            </p>
            <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric" placeholder="######" autoFocus
              style={{ width: 180, letterSpacing: 6, fontSize: 18, padding: '10px 14px', border: '1px solid #d4d4d8', borderRadius: 10, marginTop: 14 }} />
            <button onClick={sendCode} disabled={busy} type="button"
              style={{ marginLeft: 12, fontSize: 13, color: '#B8961E', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}>Resend code</button>
            <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
              <button onClick={verifyCode} disabled={busy} style={{ ...btnGold, opacity: busy ? 0.6 : 1 }}>
                {busy ? <Loader2 className="animate-spin" style={{ width: 16, height: 16 }} /> : <ShieldCheck style={{ width: 16, height: 16 }} />}
                Verify &amp; Continue
              </button>
              <button onClick={() => { setPhase('otp-request'); setError(''); }} disabled={busy} style={btnGhost}>Back</button>
            </div>
          </div>
        )}

        {phase === 'sign' && (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#111', display: 'flex', alignItems: 'center', gap: 8 }}>
              <PenLine style={{ width: 18, height: 18, color: '#B8961E' }} /> Sign to acknowledge
            </h3>
            <p style={{ color: '#6b7280', fontSize: 13, marginTop: 6 }}>
              Identity verified. Draw your signature below to finalize your acknowledgement.
            </p>
            <div style={{ marginTop: 16 }}>
              <SignaturePad onChange={setSignature} />
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
              <button onClick={confirmSign} disabled={busy} style={{ ...btnGold, opacity: busy ? 0.6 : 1 }}>
                {busy ? <Loader2 className="animate-spin" style={{ width: 16, height: 16 }} /> : <CheckCircle2 style={{ width: 16, height: 16 }} />}
                Confirm &amp; Sign
              </button>
              <button onClick={() => { setPhase('otp-verify'); setError(''); }} disabled={busy} style={btnGhost}>Back</button>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f4f4f5', padding: '32px 16px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <img src="/niyomlogo.png" alt="Niyom Wealth" style={{ height: 36 }} />
          <span style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 15, color: '#8B7355' }}>Wealth Reimagined</span>
        </div>
        {children}
        <p style={{ textAlign: 'center', color: '#9ca3af', fontSize: 12, marginTop: 24 }}>
          © Niyom Wealth Distribution LLP · Secure debit note signing
        </p>
      </div>
    </div>
  );
}
