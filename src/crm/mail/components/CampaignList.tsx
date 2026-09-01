import { Mail, Plus, Users } from 'lucide-react';
import { PrimaryButton, StatusBadge } from '../../ui/kit';
import { useCampaigns, useCreateCampaign } from '../mailClient';
import type { MailAudience, MailCampaign } from '../mailTypes';

function when(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Progress line, so an interrupted blast is obvious from the list itself. */
function progress(c: MailCampaign): string | null {
  if (c.status === 'sending') return `Sent ${c.sent_count} of ${c.recipient_count} — resume to finish`;
  if (c.status === 'sent') {
    return `Delivered to ${c.sent_count.toLocaleString('en-IN')}` +
      (c.failed_count ? ` · ${c.failed_count} failed` : '');
  }
  return null;
}

export default function CampaignList({ onOpen }: { onOpen: (id: string) => void }) {
  const { data: campaigns = [], isLoading, error } = useCampaigns();
  const create = useCreateCampaign();

  const start = async (audience: MailAudience) => {
    const id = await create.mutateAsync(audience);
    onOpen(id);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Email Campaigns</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            One email to every client, or every partner. Drafts are private until you approve them.
          </p>
        </div>
        <div className="flex gap-2">
          <PrimaryButton type="button" disabled={create.isPending} onClick={() => void start('client')}>
            <Plus size={14} /> New client email
          </PrimaryButton>
          <PrimaryButton type="button" disabled={create.isPending} onClick={() => void start('partner')}>
            <Plus size={14} /> New partner email
          </PrimaryButton>
        </div>
      </div>

      {error && (
        <div className="rounded-xl px-3 py-2 text-sm"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'rgb(239,68,68)' }}>
          {error instanceof Error ? error.message : 'Could not load campaigns.'}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      ) : campaigns.length === 0 ? (
        <div className="rounded-xl px-4 py-12 text-center"
          style={{ background: 'var(--bg-surface)', border: '1px dashed var(--border)' }}>
          <Mail size={26} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No campaigns yet. Start one above — you can generate the copy from a few keywords.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {campaigns.map((c) => (
            <button key={c.id} type="button" onClick={() => onOpen(c.id)}
              className="w-full text-left rounded-xl px-4 py-3 transition hover:opacity-80"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>
                      {c.subject || '(untitled draft)'}
                    </span>
                    <StatusBadge status={c.status} small />
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span className="font-mono">{c.campaign_no}</span>
                    <span className="inline-flex items-center gap-1">
                      <Users size={11} /> {c.audience === 'client' ? 'Clients' : 'Partners'}
                    </span>
                    <span>{when(c.created_at)}</span>
                  </div>
                </div>
                {progress(c) && (
                  <span className="text-xs shrink-0"
                    style={{ color: c.status === 'sending' ? 'rgb(245,158,11)' : 'var(--text-muted)' }}>
                    {progress(c)}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
