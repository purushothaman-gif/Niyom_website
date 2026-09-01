// Email Campaigns — admin-only bulk mail to all clients or all partners.
//
// The nav entry is already adminOnly and CRM.tsx routes non-admins elsewhere,
// but the check is repeated here so the module is safe wherever it is mounted.
// None of it is the real control: every table is behind an admin RLS policy and
// every write goes through an RPC that re-checks nw_current_emp_is_admin().

import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import type { NWEmployee } from '../types';
import { mailQueryClient, useCampaign } from './mailClient';
import CampaignList from './components/CampaignList';
import CampaignComposer from './components/CampaignComposer';

type View = { name: 'list' } | { name: 'campaign'; id: string };

function MailInner() {
  const [view, setView] = useState<View>({ name: 'list' });
  const { data: campaign, isLoading } = useCampaign(view.name === 'campaign' ? view.id : null);

  if (view.name === 'list') {
    return <CampaignList onOpen={(id) => setView({ name: 'campaign', id })} />;
  }
  if (isLoading) {
    return <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</p>;
  }
  if (!campaign) {
    return <CampaignList onOpen={(id) => setView({ name: 'campaign', id })} />;
  }
  return <CampaignComposer campaign={campaign} onBack={() => setView({ name: 'list' })} />;
}

export default function Mail({ employee }: { employee: NWEmployee }) {
  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';

  if (!isAdmin) {
    return (
      <div className="rounded-xl px-4 py-12 text-center"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
        <ShieldAlert size={26} className="mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Email campaigns are restricted to administrators.
        </p>
      </div>
    );
  }

  return (
    <QueryClientProvider client={mailQueryClient}>
      <MailInner />
    </QueryClientProvider>
  );
}
