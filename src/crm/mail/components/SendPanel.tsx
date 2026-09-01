// Audience, test send, approval and the blast itself.
//
// The self-review gate is made visible here: Approve stays locked until a test
// has been sent FOR THE CURRENT CONTENT, and Send stays locked until approved.
// The database enforces all of it again in mail_set_campaign_status and
// mail_begin_send — these buttons explain the rule, they do not implement it.

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Mail, Send, ShieldCheck, Users } from 'lucide-react';
import { GhostButton, PrimaryButton } from '../../ui/kit';
import { useAudiencePreview, useRecipientStats, useSendPass, useSetStatus, useTestSend } from '../mailClient';
import type { MailCampaign } from '../mailTypes';

interface Props {
  campaign: MailCampaign;
  /** True when the editor holds changes that have not been written yet. */
  dirty: boolean;
  onSaveFirst: () => Promise<void>;
}

export default function SendPanel({ campaign, dirty, onSaveFirst }: Props) {
  const audience = useAudiencePreview(campaign.audience, campaign.filters);
  const live = campaign.status === 'sending';
  const stats = useRecipientStats(campaign.id, live);
  const testSend = useTestSend();
  const setStatus = useSetStatus();
  const sendPass = useSendPass();

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [ack, setAck] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);

  const flags = campaign.compliance_flags ?? [];
  const tested = !!campaign.test_sent_hash && campaign.test_sent_hash === campaign.content_hash;
  const staleTest = !!campaign.test_sent_hash && campaign.test_sent_hash !== campaign.content_hash;

  useEffect(() => { setAck(false); setConfirming(false); }, [campaign.content_hash]);

  const run = async (fn: () => Promise<void>) => {
    setError(''); setNotice('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); }
  };

  const handleTest = () => run(async () => {
    if (dirty) await onSaveFirst();
    const to = await testSend.mutateAsync(campaign.id);
    setNotice(`Test email sent to ${to}. Check it before approving.`);
  });

  const handleApprove = () => run(async () => {
    await setStatus.mutateAsync({ id: campaign.id, action: 'approve', ackCompliance: ack });
    setNotice('Approved. The Send button is now unlocked.');
  });

  // Each pass drains for ~110s and reports what is left, so this loops until
  // the queue is empty. Closing the tab mid-loop is safe — the campaign stays
  // in 'sending' with its remaining rows queued, and Resume picks up there.
  const handleSend = () => run(async () => {
    setConfirming(false);
    setRunning(true);
    try {
      for (let pass = 0; pass < 200; pass++) {
        const res = await sendPass.mutateAsync(campaign.id);
        if (res.remaining <= 0) {
          setNotice(`Sent to ${res.totalSent} recipient${res.totalSent === 1 ? '' : 's'}.` +
            (res.totalFailed ? ` ${res.totalFailed} could not be delivered.` : ''));
          return;
        }
      }
      setNotice('Still sending. Press Resume to continue.');
    } finally {
      setRunning(false);
    }
  });

  const busy = testSend.isPending || setStatus.isPending || running;
  const sendable = audience.data?.sendable ?? 0;

  return (
    <div className="space-y-4">
      {/* Audience ---------------------------------------------------------- */}
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 mb-2">
          <Users size={15} style={{ color: 'var(--accent)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Recipients</span>
        </div>
        {audience.isLoading ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Counting…</p>
        ) : (
          <>
            <p className="text-2xl font-bold" style={{ color: 'var(--text)' }}>
              {sendable.toLocaleString('en-IN')}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {campaign.audience === 'client' ? 'clients' : 'partners'} will receive this
              {(audience.data?.suppressed ?? 0) > 0 &&
                `, ${audience.data?.suppressed} excluded for having unsubscribed`}.
            </p>
          </>
        )}
      </div>

      {/* Compliance -------------------------------------------------------- */}
      {flags.length > 0 && (
        <div className="rounded-xl p-4"
          style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={15} style={{ color: 'rgb(245,158,11)' }} />
            <span className="text-sm font-semibold" style={{ color: 'rgb(245,158,11)' }}>
              {flags.length} compliance {flags.length === 1 ? 'flag' : 'flags'}
            </span>
          </div>
          <ul className="text-xs space-y-1 mb-3" style={{ color: 'var(--text)' }}>
            {flags.map((f, i) => (
              <li key={i}>
                <span className="font-mono">“{f.phrase}”</span> in {f.field} — reads as a {f.label}.
              </li>
            ))}
          </ul>
          <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
            Niyom is an AMFI-registered distributor, so mail to clients cannot recommend a product or
            promise a return. Reword the copy, or acknowledge below if these are false positives.
          </p>
          <label className="flex items-start gap-2 text-xs cursor-pointer" style={{ color: 'var(--text)' }}>
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
            I have reviewed these flags and this wording is acceptable.
          </label>
        </div>
      )}

      {/* Progress ---------------------------------------------------------- */}
      {(campaign.status === 'sending' || campaign.status === 'sent') && stats.data && (
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between text-sm mb-2">
            <span style={{ color: 'var(--text)' }}>
              Sent {stats.data.sent.toLocaleString('en-IN')} of {stats.data.total.toLocaleString('en-IN')}
            </span>
            {stats.data.failed > 0 && (
              <span style={{ color: 'rgb(239,68,68)' }}>{stats.data.failed} failed</span>
            )}
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
            <div className="h-full rounded-full transition-all"
              style={{
                width: `${stats.data.total ? Math.round((stats.data.sent / stats.data.total) * 100) : 0}%`,
                background: 'var(--accent)',
              }} />
          </div>
        </div>
      )}

      {/* Messages ---------------------------------------------------------- */}
      {error && (
        <div className="rounded-xl px-3 py-2 text-sm"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'rgb(239,68,68)' }}>
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl px-3 py-2 text-sm"
          style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: 'rgb(16,185,129)' }}>
          {notice}
        </div>
      )}
      {staleTest && campaign.status === 'draft' && (
        <div className="rounded-xl px-3 py-2 text-sm"
          style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: 'rgb(245,158,11)' }}>
          This campaign has changed since your last test. Send a fresh test before approving.
        </div>
      )}

      {/* Actions ----------------------------------------------------------- */}
      <div className="space-y-2">
        {campaign.status === 'draft' && (
          <>
            <PrimaryButton type="button" onClick={handleTest} disabled={busy || !campaign.subject.trim()}>
              <Mail size={14} /> {testSend.isPending ? 'Sending…' : 'Send me a test'}
            </PrimaryButton>
            <PrimaryButton type="button" onClick={handleApprove}
              disabled={busy || dirty || !tested || (flags.length > 0 && !ack)}>
              <ShieldCheck size={14} /> Approve
            </PrimaryButton>
            {!tested && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Approval unlocks once you have received a test of this exact version.
              </p>
            )}
            {dirty && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Save your changes first.</p>
            )}
          </>
        )}

        {campaign.status === 'approved' && !confirming && (
          <>
            <PrimaryButton type="button" onClick={() => setConfirming(true)} disabled={busy || sendable === 0}>
              <Send size={14} /> Send to {sendable.toLocaleString('en-IN')} {campaign.audience === 'client' ? 'clients' : 'partners'}
            </PrimaryButton>
            <GhostButton type="button" disabled={busy}
              onClick={() => run(() => setStatus.mutateAsync({ id: campaign.id, action: 'cancel' }))}>
              Cancel campaign
            </GhostButton>
          </>
        )}

        {campaign.status === 'approved' && confirming && (
          <div className="rounded-xl p-4"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
            <p className="text-sm mb-3" style={{ color: 'var(--text)' }}>
              This sends <strong>{sendable.toLocaleString('en-IN')}</strong> emails right now.
              It cannot be undone once it starts.
            </p>
            <div className="flex gap-2">
              <PrimaryButton type="button" onClick={handleSend} disabled={busy}>
                Yes, send it
              </PrimaryButton>
              <GhostButton type="button" onClick={() => setConfirming(false)} disabled={busy}>
                Not yet
              </GhostButton>
            </div>
          </div>
        )}

        {campaign.status === 'sending' && (
          <PrimaryButton type="button" onClick={handleSend} disabled={running}>
            <Send size={14} /> {running ? 'Sending…' : 'Resume sending'}
          </PrimaryButton>
        )}

        {campaign.status === 'sent' && (
          <div className="flex items-center gap-2 text-sm" style={{ color: 'rgb(16,185,129)' }}>
            <CheckCircle2 size={15} />
            Delivered to {campaign.sent_count.toLocaleString('en-IN')} recipients.
          </div>
        )}
      </div>
    </div>
  );
}
