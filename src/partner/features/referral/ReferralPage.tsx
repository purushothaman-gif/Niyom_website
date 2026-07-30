import { useState } from 'react';
import { Share2, Copy, Check, MousePointerClick, UserPlus, Users, ExternalLink } from 'lucide-react';
import { Card } from '../../../portal/components/Card';
import { KpiStat } from '../../../portal/components/KpiStat';
import { SectionHeader } from '../../../portal/components/SectionHeader';
import { EmptyState } from '../../../portal/components/EmptyState';
import { buildReferralUrl } from '../../../crm/marketing/marketingConstants';
import type { PartnerReferral } from '../../types';

interface Props {
  referral: PartnerReferral | null;
}

/**
 * The partner's referral link and its funnel.
 *
 * The code is an opaque 8-character string (mkt_generate_ref_code), not the DSA
 * code — the same reasoning as employee links: a public URL should not leak an
 * internal identifier.
 *
 * A signup arriving through this link is created with sourced_via='dsa' and
 * dsa_id set, so it flows into the normal DSA payout calculation rather than
 * being merely attributed.
 */
export function ReferralPage({ referral }: Props) {
  const [copied, setCopied] = useState(false);

  if (!referral?.ref_code) {
    return (
      <Card>
        <EmptyState
          icon={Share2}
          title="Your referral link is being set up"
          hint="It is created when your portal access is enabled. Please refresh in a moment, or contact your relationship manager."
        />
      </Card>
    );
  }

  const url = buildReferralUrl(referral.ref_code);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the URL is visible and selectable anyway */
    }
  };

  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({
          title: 'Open a free account with Niyom Wealth',
          text: 'Start your investment journey with Niyom Wealth.',
          url,
        });
        return;
      } catch {
        /* user dismissed the share sheet */
      }
    }
    void copy();
  };

  return (
    <div className="space-y-6">
      <Card accent>
        <SectionHeader title="Your Referral Link" icon={Share2} />
        <p className="mt-4 text-sm text-text-muted">
          Share this link. Anyone who opens an account through it is recorded against
          you automatically — no code for them to type, and nothing for you to claim
          afterwards.
        </p>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <div className="min-w-0 flex-1 overflow-x-auto rounded-token-md border border-border bg-bg-surface px-3.5 py-3">
            <code className="whitespace-nowrap font-mono text-sm text-text-primary">{url}</code>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={copy}
              className="flex flex-1 items-center justify-center gap-2 rounded-token-md border border-border bg-bg-surface px-4 py-3 text-xs font-semibold text-text-primary transition-colors hover:text-accent sm:flex-none"
            >
              {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={share}
              className="flex flex-1 items-center justify-center gap-2 rounded-token-md px-4 py-3 text-xs font-bold text-on-accent sm:flex-none"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
            >
              <Share2 className="h-4 w-4" /> Share
            </button>
          </div>
        </div>

        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-accent transition-colors hover:text-accent-soft"
        >
          Preview the page your prospects will see <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </Card>

      <Card>
        <SectionHeader title="Link Performance" icon={MousePointerClick} />
        <div className="mt-5 grid grid-cols-3 gap-6">
          <KpiStat label="Link opens" value={String(referral.clicks)} sub="All time" />
          <KpiStat label="Leads created" value={String(referral.leads)} sub="Signed up" />
          <KpiStat
            label="Accounts opened"
            value={String(referral.clients)}
            color="var(--success)"
            sub="Mapped to you for payout"
            trend="up"
          />
        </div>
        {referral.clicks === 0 && (
          <p className="mt-5 border-t border-border-subtle pt-4 text-xs text-text-faint">
            No opens recorded yet. Share the link on WhatsApp or social media to get started.
          </p>
        )}
      </Card>

      <Card padding="md">
        <div className="flex items-start gap-3">
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
          <p className="text-xs text-text-muted">
            Prefer to hand over details yourself? Use{' '}
            <span className="inline-flex items-center gap-1 font-semibold text-text-primary">
              <UserPlus className="h-3 w-3" /> Submit a Lead
            </span>{' '}
            and your relationship manager will follow up directly.
          </p>
        </div>
      </Card>
    </div>
  );
}
