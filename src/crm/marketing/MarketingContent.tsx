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
import EmployeeGallery from './components/EmployeeGallery';
import AnalyticsDashboard from './components/AnalyticsDashboard';

interface Props {
  employee: NWEmployee;
  onNavigate?: (page: CRMPage, params?: Record<string, string>) => void;
}

type View =
  | { name: 'library' }
  | { name: 'studio' }
  | { name: 'detail'; content: MktContent }
  | { name: 'analytics' };

export default function MarketingContent({ employee }: Props) {
  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';
  const [view, setView] = useState<View>({ name: 'library' });

  return (
    <QueryClientProvider client={mktQueryClient}>
      {!isAdmin ? (
        <EmployeeGallery employee={employee} />
      ) : view.name === 'library' ? (
        <ContentLibrary
          onOpen={content => setView({ name: 'detail', content })}
          onNew={() => setView({ name: 'studio' })}
          onAnalytics={() => setView({ name: 'analytics' })} />
      ) : view.name === 'studio' ? (
        <ContentStudio employee={employee}
          onBack={() => setView({ name: 'library' })}
          onSaved={content => setView({ name: 'detail', content })} />
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
