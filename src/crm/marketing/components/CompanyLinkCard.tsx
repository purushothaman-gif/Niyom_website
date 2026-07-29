// The company onboarding link, for posts made from NIYOM's own social accounts.
//
// Distinct from an employee's personal link on purpose. Employees post approved
// content from their own accounts and get credited through their own code; the
// company's official accounts post on behalf of nobody in particular. Signups
// arriving through this link stay on the house account (NIYOM-001), exactly as a
// walk-in does, and are reported as their own channel rather than counting
// toward whichever person happens to be an admin — otherwise company-driven
// numbers would sit on that person's row and the employee leaderboard would
// stop being a fair comparison.

import { useState } from 'react';
import { Building2, Check, Copy, Link2, MousePointerClick, UserPlus, Users } from 'lucide-react';
import { buildCompanyUrl } from '../marketingConstants';
import { useCompanyChannelStats, useCompanyReferralLink } from '../marketingClient';

function Stat({ icon: Icon, label, value }: {
  icon: typeof Users; label: string; value: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--accent-soft)' }} />
      <div className="leading-tight">
        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{label}</p>
      </div>
    </div>
  );
}

export default function CompanyLinkCard() {
  const { data: link, isLoading } = useCompanyReferralLink();
  const { data: stats } = useCompanyChannelStats();
  const [copied, setCopied] = useState(false);

  if (isLoading || !link) return null;

  // The bare URL, with no tracking parameter — this is what goes out on NIYOM's
  // own accounts. The link's ref_code still exists as the channel's identity in
  // the database and is what attribution rows are written against; it just
  // never has to appear in the URL, because a visit without a code resolves to
  // this link server-side.
  const url = buildCompanyUrl();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard can be blocked; the URL is on screen to copy by hand.
    }
  };

  return (
    <div
      className="rounded-2xl p-4 mb-5"
      style={{
        background: 'rgba(var(--accent-soft-rgb),0.08)',
        border: '1px solid rgba(var(--accent-soft-rgb),0.25)',
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--accent-soft)' }}>
            <Building2 className="w-3.5 h-3.5" />
            {link.label ?? 'Company onboarding link'}
          </p>
          <p className="text-xs font-mono mt-1 break-all" style={{ color: 'var(--text-muted)' }}>
            {url}
          </p>
          <p className="text-xs mt-1.5" style={{ color: 'var(--text-faint)' }}>
            Use this when posting from NIYOM&apos;s own accounts. Signups stay on the house
            account and are reported separately, so they don&apos;t count toward any
            employee&apos;s numbers.
          </p>
        </div>

        <button
          onClick={copy}
          className="px-3 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 flex-shrink-0 transition-colors"
          style={{
            background: 'var(--accent-soft)',
            color: 'var(--text-on-accent)',
          }}
        >
          {copied
            ? <><Check className="w-4 h-4" /> Copied</>
            : <><Copy className="w-4 h-4" /> Copy link</>}
        </button>
      </div>

      {stats && (stats.clicks > 0 || stats.leads > 0 || stats.clients > 0) && (
        <div
          className="flex flex-wrap gap-x-7 gap-y-2 mt-3 pt-3"
          style={{ borderTop: '1px solid rgba(var(--accent-soft-rgb),0.2)' }}
        >
          <Stat icon={MousePointerClick} label="clicks" value={stats.clicks} />
          <Stat icon={UserPlus} label="leads" value={stats.leads} />
          <Stat icon={Users} label="clients onboarded" value={stats.clients} />
        </div>
      )}

      {!link.active && (
        <p className="text-xs mt-2 flex items-center gap-1.5" style={{ color: 'var(--danger)' }}>
          <Link2 className="w-3.5 h-3.5" /> This link is deactivated — signups through it
          will fall back to the house account without company attribution.
        </p>
      )}
    </div>
  );
}
