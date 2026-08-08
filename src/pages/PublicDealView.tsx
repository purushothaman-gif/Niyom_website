import { useCallback, useEffect, useRef, useState } from 'react';
import { LogoLoader } from '../components/LogoLoader';
import { supabase } from '../lib/supabase';
import { edgeFunctionErrorMessage } from '../lib/edgeFunctionError';
import html2pdf from 'html2pdf.js';
import DealDocument, { DealDocumentData } from '../crm/DealDocument';
import { CheckCircle2, XCircle, AlertCircle, ShieldCheck, Loader2, PenLine, Mail } from 'lucide-react';

interface Props { token: string; }

type Intent = 'accept' | 'reject';
type Phase =
  | 'loading'
  | 'review'
  | 'tc'            // mandatory Terms & Conditions acceptance (accept path only)
  | 'otp-request'   // item 3
  | 'otp-verify'    // item 4
  | 'sign'          // item 5
  | 'success-accepted'
  | 'success-rejected'
  | 'terminal';

type PublicDeal = DealDocumentData & { acceptance_status: string; client_email_masked: string };

function buildPdfOpts(deal: PublicDeal) {
  return {
    margin: 0,
    filename: `DEAL-CONFIRMATION-${deal.confirmation_number}-${deal.deal_date}.pdf`,
    // JPEG (not PNG) + scale 2 keeps the *transmitted* signed PDF small enough
    // to stay well under the Edge Function payload limit. PNG@scale3 produced a
    // ~47 MB / ~63 MB-base64 body that tripped WORKER_RESOURCE_LIMIT. The crisp
    // signature is still preserved separately as signature.png (sent as its own
    // field and stored independently).
    image: { type: 'jpeg' as const, quality: 0.92 },
    html2canvas: { scale: 2, useCORS: true, logging: false, windowWidth: 794, letterRendering: true },
    jsPDF: { unit: 'mm' as const, format: 'a4', orientation: 'portrait' as const },
    pagebreak: { mode: ['css', 'legacy'] as string[] },
  };
}

// ---------- Signature pad (item 5) ----------
// High-resolution capture: the drawing buffer is sized to the *displayed*
// dimensions × devicePixelRatio × an oversample factor, while the drawing
// context is transformed to CSS-pixel space. This keeps strokes aligned to the
// pointer (regardless of responsive width) and exports a crisp, print-quality
// PNG that no longer blurs when scaled in the signed PDF.
const SIG_OVERSAMPLE = 2;

function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);

  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const cssW = rect.width || 520;
    const cssH = rect.height || 160;
    const ratio = (window.devicePixelRatio || 1) * SIG_OVERSAMPLE;
    canvas.width = Math.round(cssW * ratio);
    canvas.height = Math.round(cssH * ratio);
    // Map drawing units to CSS pixels so pointer coords line up 1:1.
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
  }, []);

  useEffect(() => {
    initCanvas();
    // Re-init on resize only when the pad is still empty, so we never wipe a
    // signature the client has already drawn.
    const onResize = () => { if (!hasInk.current) initCanvas(); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [initCanvas]);

  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const start = (e: React.PointerEvent) => {
    drawing.current = true;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    hasInk.current = true;
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (hasInk.current) onChange(canvasRef.current!.toDataURL('image/png'));
  };
  const clear = () => {
    initCanvas();
    hasInk.current = false;
    onChange(null);
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        style={{ width: '100%', maxWidth: 520, height: 160, border: '1px solid #d4d4d8', borderRadius: 10, touchAction: 'none', background: '#fff', cursor: 'crosshair' }}
      />
      <button onClick={clear} type="button" style={{ marginTop: 8, fontSize: 13, color: '#6b7280', textDecoration: 'underline' }}>
        Clear signature
      </button>
    </div>
  );
}

const card: React.CSSProperties = { background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' };
const gold = 'linear-gradient(135deg, #D4AF37, #B8961E)';
const btnGold: React.CSSProperties = { background: gold, color: '#000', fontWeight: 700, padding: '12px 28px', borderRadius: 10, display: 'inline-flex', alignItems: 'center', gap: 8 };
const btnGhost: React.CSSProperties = { background: '#f3f4f6', color: '#374151', fontWeight: 600, padding: '12px 20px', borderRadius: 10 };

export default function PublicDealView({ token }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [deal, setDeal] = useState<PublicDeal | null>(null);
  const [terminalReason, setTerminalReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [intent, setIntent] = useState<Intent>('accept');
  const [otp, setOtp] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [tcChecked, setTcChecked] = useState(false);

  // Load deal (item 1)
  useEffect(() => {
    (async () => {
      const { data, error: fnErr } = await supabase.functions.invoke('get-deal-by-token', { body: { token } });
      if (fnErr || !data) { setPhase('terminal'); setTerminalReason('error'); return; }
      if (!data.valid) { setPhase('terminal'); setTerminalReason(data.reason || 'invalid'); return; }
      setDeal(data.deal as PublicDeal);
      setPhase('review');
    })();
  }, [token]);

  const maskedEmail = deal?.client_email_masked || 'your registered email';

  const goRequest = (which: Intent) => {
    setIntent(which);
    setOtp('');
    setSignature(null);
    setRejectReason('');
    setError('');
    setPhase('otp-request');
  };

  // Accept path begins with mandatory Terms & Conditions acceptance.
  const startAccept = () => {
    setIntent('accept');
    setOtp('');
    setSignature(null);
    setRejectReason('');
    setTcChecked(false);
    setError('');
    setPhase('tc');
  };

  // Records T&C acceptance (audit) then advances to OTP request.
  const acceptTerms = useCallback(async () => {
    if (!tcChecked) { setError('Please accept the Terms & Conditions to continue.'); return; }
    setBusy(true); setError('');
    const { data, error: fnErr } = await supabase.functions.invoke('record-tc-acceptance', { body: { token } });
    setBusy(false);
    if (fnErr || !data?.success) { setError(await edgeFunctionErrorMessage(fnErr, data, 'Could not record your acceptance. Please try again.', { allowLibraryMessage: false })); return; }
    setPhase('otp-request');
  }, [token, tcChecked]);

  // item 3 → sends the code, then advances to the verify screen
  const sendCode = useCallback(async () => {
    setBusy(true); setError('');
    const { data, error: fnErr } = await supabase.functions.invoke('send-deal-otp', { body: { token, purpose: intent } });
    setBusy(false);
    if (fnErr || !data?.success) { setError(await edgeFunctionErrorMessage(fnErr, data, 'Could not send the verification code.', { allowLibraryMessage: false })); return; }
    setOtp('');
    setPhase('otp-verify');
  }, [token, intent]);

  // item 4 → verifies the code (non-consuming); accept advances to sign, reject finalizes
  const verifyCode = async () => {
    if (otp.trim().length < 6) { setError('Enter the 6-digit code sent to your email.'); return; }
    setBusy(true); setError('');
    const { data, error: fnErr } = await supabase.functions.invoke('verify-deal-otp', {
      body: { token, otp: otp.trim(), purpose: intent },
    });
    if (fnErr || !data?.verified) { setBusy(false); setError(await edgeFunctionErrorMessage(fnErr, data, 'Verification failed.', { allowLibraryMessage: false })); return; }

    if (intent === 'accept') {
      setBusy(false);
      setPhase('sign');
      return;
    }
    // reject: no signature step — submit immediately (reject-deal re-verifies + consumes)
    const { data: rj, error: rjErr } = await supabase.functions.invoke('reject-deal', {
      body: { token, otp: otp.trim(), reason: rejectReason.trim() },
    });
    setBusy(false);
    if (rjErr || !rj?.success) { setError(await edgeFunctionErrorMessage(rjErr, rj, 'Could not record your rejection.', { allowLibraryMessage: false })); return; }
    setPhase('success-rejected');
  };

  // item 6 → generate signed PDF then finalize acceptance (accept-deal re-verifies + consumes)
  const confirmAccept = async () => {
    if (!deal) return;
    if (!signature) { setError('Please draw your signature to proceed.'); return; }
    setBusy(true); setError('');
    try {
      const el = document.getElementById('signed-pdf-content');
      if (!el) throw new Error('Document not ready. Please retry.');
      const dataUri: string = await html2pdf().set(buildPdfOpts(deal)).from(el).output('datauristring');
      const signedPdfBase64 = dataUri.split(',')[1];

      const { data, error: fnErr } = await supabase.functions.invoke('accept-deal', {
        body: { token, otp: otp.trim(), signatureBase64: signature, signedPdfBase64 },
      });
      if (fnErr || !data?.success) { setError(await edgeFunctionErrorMessage(fnErr, data, 'Could not complete acceptance.', { allowLibraryMessage: false })); setBusy(false); return; }
      setPhase('success-accepted');
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
          <LogoLoader size={48} label="Loading your deal confirmation…" />
        </div>
      </Shell>
    );
  }

  if (phase === 'terminal') {
    const map: Record<string, { title: string; msg: string; icon: JSX.Element }> = {
      invalid: { title: 'Link not valid', msg: 'This deal confirmation link is invalid or has been replaced by an updated one.', icon: <AlertCircle style={{ width: 40, height: 40, color: '#ef4444' }} /> },
      expired: { title: 'Link expired', msg: 'This link has expired. Please contact your relationship manager for an updated link.', icon: <AlertCircle style={{ width: 40, height: 40, color: '#f59e0b' }} /> },
      accepted: { title: 'Already accepted', msg: 'This deal confirmation has already been accepted and is now locked.', icon: <CheckCircle2 style={{ width: 40, height: 40, color: '#10b981' }} /> },
      rejected: { title: 'Already responded', msg: 'This deal confirmation was rejected. Please contact your relationship manager.', icon: <XCircle style={{ width: 40, height: 40, color: '#ef4444' }} /> },
      error: { title: 'Something went wrong', msg: 'We could not load this deal confirmation. Please try again later.', icon: <AlertCircle style={{ width: 40, height: 40, color: '#ef4444' }} /> },
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

  if (phase === 'success-accepted' || phase === 'success-rejected') {
    const accepted = phase === 'success-accepted';
    return (
      <Shell>
        <div style={{ ...card, padding: 48, textAlign: 'center', maxWidth: 480, margin: '0 auto' }}>
          {accepted
            ? <CheckCircle2 style={{ width: 48, height: 48, color: '#10b981', margin: '0 auto' }} />
            : <XCircle style={{ width: 48, height: 48, color: '#ef4444', margin: '0 auto' }} />}
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#111', marginTop: 16 }}>
            {accepted ? 'Deal Accepted' : 'Deal Rejected'}
          </h2>
          <p style={{ marginTop: 8, color: '#6b7280' }}>
            {accepted
              ? 'Thank you. Your acceptance and e-signature have been recorded. A signed copy has been saved to your records.'
              : 'Your response has been recorded. Your relationship manager will be in touch.'}
          </p>
        </div>
      </Shell>
    );
  }

  if (!deal) return null;

  return (
    <Shell>
      {/* Hidden signature-embedded document used only for signed-PDF generation (item 6) */}
      <div style={{ position: 'absolute', left: -99999, top: 0 }} aria-hidden>
        <DealDocument
          deal={deal}
          pdfElementId="signed-pdf-content"
          signatureDataUrl={signature || undefined}
          acceptedDate={new Date().toISOString()}
        />
      </div>

      {/* Document preview — Confirmation/signature section hidden until signed */}
      <div style={{ ...card, padding: 16, overflowX: 'auto' }}>
        <DealDocument deal={deal} pdfElementId="public-preview-content" showConfirmation={false} />
      </div>

      {error && (
        <div style={{ ...card, borderColor: '#fecaca', background: '#fef2f2', padding: 14, display: 'flex', gap: 10, alignItems: 'center', marginTop: 16 }}>
          <AlertCircle style={{ width: 18, height: 18, color: '#ef4444', flexShrink: 0 }} />
          <span style={{ color: '#b91c1c', fontSize: 14 }}>{error}</span>
        </div>
      )}

      {/* Action panel */}
      <div style={{ ...card, padding: 24, marginTop: 16 }}>
        {/* item 2: Accept / Reject */}
        {phase === 'review' && (
          <div>
            <p style={{ color: '#374151', fontSize: 14, marginBottom: 16 }}>
              Please review the deal confirmation above. To proceed you will verify a code sent to your registered email.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button onClick={startAccept} style={btnGold}>
                <CheckCircle2 style={{ width: 16, height: 16 }} /> Accept Deal
              </button>
              <button onClick={() => goRequest('reject')}
                style={{ background: '#fff', color: '#b91c1c', border: '1px solid #fecaca', fontWeight: 700, padding: '12px 28px', borderRadius: 10, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <XCircle style={{ width: 16, height: 16 }} /> Reject Deal
              </button>
            </div>
          </div>
        )}

        {/* Mandatory Terms & Conditions acceptance (accept path) */}
        {phase === 'tc' && (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#111', display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShieldCheck style={{ width: 18, height: 18, color: '#B8961E' }} /> Accept Terms & Conditions
            </h3>
            <p style={{ color: '#6b7280', fontSize: 13, marginTop: 6 }}>
              Please confirm you have reviewed the deal details and Terms &amp; Conditions shown above before proceeding.
            </p>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 16, cursor: 'pointer' }}>
              <input type="checkbox" checked={tcChecked} onChange={(e) => setTcChecked(e.target.checked)}
                style={{ width: 18, height: 18, marginTop: 2, flexShrink: 0, accentColor: '#B8961E', cursor: 'pointer' }} />
              <span style={{ fontSize: 14, color: '#374151', lineHeight: 1.5 }}>
                I have read, understood and agree to the Terms &amp; Conditions and deal details mentioned above.
              </span>
            </label>
            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              <button onClick={acceptTerms} disabled={busy || !tcChecked}
                style={{ ...btnGold, opacity: busy || !tcChecked ? 0.5 : 1, cursor: busy || !tcChecked ? 'not-allowed' : 'pointer' }}>
                {busy ? <Loader2 className="animate-spin" style={{ width: 16, height: 16 }} /> : <CheckCircle2 style={{ width: 16, height: 16 }} />}
                Continue
              </button>
              <button onClick={() => { setPhase('review'); setError(''); }} disabled={busy} style={btnGhost}>Back</button>
            </div>
          </div>
        )}

        {/* item 3: OTP request */}
        {phase === 'otp-request' && (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#111', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Mail style={{ width: 18, height: 18, color: '#B8961E' }} />
              Verify your identity to {intent === 'accept' ? 'accept' : 'reject'}
            </h3>
            <p style={{ color: '#6b7280', fontSize: 13, marginTop: 6 }}>
              We’ll send a 6-digit verification code to <strong>{maskedEmail}</strong>.
            </p>
            {intent === 'reject' && (
              <>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginTop: 16, marginBottom: 6 }}>Reason (optional)</label>
                <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3}
                  placeholder="Let us know why (optional)…"
                  style={{ width: '100%', padding: '10px 14px', border: '1px solid #d4d4d8', borderRadius: 10, resize: 'none' }} />
              </>
            )}
            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              <button onClick={sendCode} disabled={busy} style={btnGold}>
                {busy ? <Loader2 className="animate-spin" style={{ width: 16, height: 16 }} /> : <Mail style={{ width: 16, height: 16 }} />}
                Send Code
              </button>
              <button onClick={() => { setPhase('review'); setError(''); }} disabled={busy} style={btnGhost}>Back</button>
            </div>
          </div>
        )}

        {/* item 4: OTP verification */}
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
              style={{ marginLeft: 12, fontSize: 13, color: '#B8961E', textDecoration: 'underline' }}>Resend code</button>
            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              <button onClick={verifyCode} disabled={busy} style={btnGold}>
                {busy ? <Loader2 className="animate-spin" style={{ width: 16, height: 16 }} /> : <ShieldCheck style={{ width: 16, height: 16 }} />}
                {intent === 'accept' ? 'Verify & Continue' : 'Verify & Reject'}
              </button>
              <button onClick={() => { setPhase('otp-request'); setError(''); }} disabled={busy} style={btnGhost}>Back</button>
            </div>
          </div>
        )}

        {/* item 5 + 6: signature + signed PDF */}
        {phase === 'sign' && (
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#111', display: 'flex', alignItems: 'center', gap: 8 }}>
              <PenLine style={{ width: 18, height: 18, color: '#B8961E' }} /> Sign to confirm acceptance
            </h3>
            <p style={{ color: '#6b7280', fontSize: 13, marginTop: 6 }}>
              Identity verified. Draw your signature below to finalize and generate your signed copy.
            </p>
            <div style={{ marginTop: 16 }}>
              <SignaturePad onChange={setSignature} />
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              <button onClick={confirmAccept} disabled={busy} style={btnGold}>
                {busy ? <Loader2 className="animate-spin" style={{ width: 16, height: 16 }} /> : <CheckCircle2 style={{ width: 16, height: 16 }} />}
                Confirm Acceptance
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
          © Niyom Wealth Distribution LLP · Secure deal confirmation
        </p>
      </div>
    </div>
  );
}
