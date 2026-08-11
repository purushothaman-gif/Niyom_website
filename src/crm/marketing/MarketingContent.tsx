// Marketing Tool — Content Creation module container.
//
// Admins get the studio, library, detail review and analytics; employees get a
// read-only gallery of approved, unexpired content. The role branch happens
// here rather than at the router so both roles can share the one page key.
// Scopes React Query to the module, mirroring bonds/Bonds.tsx.

import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { NWEmployee, CRMPage } from '../types';
import { mktQueryClient } from './marketingClient';
import { MktContent } from './marketingTypes';
import ContentLibrary from './components/ContentLibrary';
import ContentStudio from './components/ContentStudio';
import ContentDetail from './components/ContentDetail';
import ContentGallery from './components/ContentGallery';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import AutoSchedule from './components/AutoSchedule';

interface Props {
  employee: NWEmployee;
  onNavigate?: (page: CRMPage, params?: Record<string, string>) => void;
}

type View =
  | { name: 'library' }
  | { name: 'studio' }
  | { name: 'detail'; content: MktContent }
  | { name: 'analytics' }
  // The automated daily batch's rotation, visible before anything is generated.
  | { name: 'auto' }
  // Admins posting from NIYOM's own accounts: the same gallery employees get,
  // on the company channel.
  | { name: 'company' };

export default function MarketingContent({ employee }: Props) {
  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';
  const [view, setView] = useState<View>({ name: 'library' });

  return (
    <QueryClientProvider client={mktQueryClient}>
      {!isAdmin ? (
        <ContentGallery employee={employee} />
      ) : view.name === 'company' ? (
        <ContentGallery employee={employee} channel="company"
          onBack={() => setView({ name: 'library' })} />
      ) : view.name === 'library' ? (
        <ContentLibrary
          onOpen={content => setView({ name: 'detail', content })}
          onNew={() => setView({ name: 'studio' })}
          onAnalytics={() => setView({ name: 'analytics' })}
          onAutoSchedule={() => setView({ name: 'auto' })}
          onCompanyPosting={() => setView({ name: 'company' })} />
      ) : view.name === 'studio' ? (
        <ContentStudio employee={employee}
          onBack={() => setView({ name: 'library' })}
          onSaved={content => setView({ name: 'detail', content })} />
      ) : view.name === 'auto' ? (
        <AutoSchedule onBack={() => setView({ name: 'library' })} />
      ) : view.name === 'detail' ? (
        <ContentDetail content={view.content} employee={employee}
          onBack={() => setView({ name: 'library' })}
          onChanged={content => setView({ name: 'detail', content })}
          onDeleted={() => setView({ name: 'library' })} />
      ) : (
        <AnalyticsDashboard onBack={() => setView({ name: 'library' })} />
      )}
    </QueryClientProvider>
  );
}
