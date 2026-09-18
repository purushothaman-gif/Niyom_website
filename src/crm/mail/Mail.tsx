// Email Campaigns — email marketing for every employee.
//
// Admins write as the company (support@niyomwealth.com) to any client or
// partner; employees write from their own mailbox to their own book only.
// None of that is decided here: the sender is fixed by a database trigger,
// reach by mail_effective_filters, and every lifecycle RPC re-checks
// mail_can_manage(campaign).

import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { NWEmployee } from '../types';
import { mailQueryClient, useCampaign } from './mailClient';
import CampaignList from './components/CampaignList';
import CampaignComposer from './components/CampaignComposer';

type View = { name: 'list' } | { name: 'campaign'; id: string };

function MailInner({ isAdmin }: { isAdmin: boolean }) {
  const [view, setView] = useState<View>({ name: 'list' });
  const { data: campaign, isLoading } = useCampaign(view.name === 'campaign' ? view.id : null);

  if (view.name === 'list') {
    return <CampaignList isAdmin={isAdmin} onOpen={(id) => setView({ name: 'campaign', id })} />;
  }
  if (isLoading) {
    return <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading…</p>;
  }
  if (!campaign) {
    return <CampaignList isAdmin={isAdmin} onOpen={(id) => setView({ name: 'campaign', id })} />;
  }
  return <CampaignComposer campaign={campaign} isAdmin={isAdmin} onBack={() => setView({ name: 'list' })} />;
}

export default function Mail({ employee }: { employee: NWEmployee }) {
  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';

  return (
    <QueryClientProvider client={mailQueryClient}>
      <MailInner isAdmin={isAdmin} />
    </QueryClientProvider>
  );
}
