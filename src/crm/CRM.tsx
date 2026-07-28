import { useEffect, useState } from 'react';
import { LogoLoader } from '../components/LogoLoader';
import { supabase } from '../lib/supabase';
import { NWEmployee, CRMPage } from './types';
import { evaluateMfaGate, isMfaUnavailable, clearStorageKeepingTrustedDevices } from './mfa';
import CRMLogin from './CRMLogin';
import ChangePassword from './ChangePassword';
import Layout from './Layout';
import Dashboard from './Dashboard';
import Leads from './leads/Leads';
import Bonds from './bonds/Bonds';
import MarketingContent from './marketing/MarketingContent';
import ClientOnboarding from './ClientOnboarding';
import ManageClients from './ManageClients';
import Portfolio from './Portfolio';
import Transactions from './Transactions';
import Reports from './Reports';
import Documents from './Documents';
import AdminDocuments from './AdminDocuments';
import MIS from './MIS';
import DSAPayout from './DSAPayout';
import DSAManagement from './DSAManagement';
import Employees from './Employees';
import Settings from './Settings';
import DealConfirmation from './DealConfirmation';
import TransferQueue from './TransferQueue';
import SupportTickets from './SupportTickets';

export default function CRM() {
  const [employee, setEmployee] = useState<NWEmployee | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<CRMPage>('dashboard');
  const [pageParams, setPageParams] = useState<Record<string, string>>({});

  useEffect(() => {
  const path = window.location.pathname;

  const route = path.replace('/crm/', '');

  const validPages = [
    'dashboard',
    'leads',
    'onboarding',
    'deal_confirmation',
    'transfer_queue',
    'clients',
    'portfolio',
    'transactions',
    'reports',
    'bonds',
    'marketing_content',
    'mis',
    'dsa_management',
    'dsa_payout',
    'documents',
    'admin_documents',
    'employees',
    'support_tickets',
    'settings'
  ];

  if (validPages.includes(route)) {
    setPage(route as CRMPage);
  }
}, []);

  useEffect(() => {
    const loadEmployee = async (userId: string) => {
      const { data } = await supabase
        .from('nw_employees').select('*')
        .eq('auth_user_id', userId).eq('status', 'active').maybeSingle();
      return (data as NWEmployee) || null;
    };

    // Restoring a session on page load must re-check the second factor. A
    // privileged session that never completed (tab closed on the code screen)
    // is still a valid aal1 session in storage, and without this it would sail
    // straight into the CRM on the next visit.
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const emp = await loadEmployee(session.user.id);
        if (emp) {
          let gate: Awaited<ReturnType<typeof evaluateMfaGate>>;
          try {
            gate = await evaluateMfaGate(emp);
          } catch (err) {
            // TOTP off project-wide -> nobody can enrol, so enforcing would lock
            // every admin out. Anything else -> do not fail open.
            gate = isMfaUnavailable(err) ? 'ok' : 'challenge';
          }
          if (gate === 'ok') {
            setEmployee(emp);
          } else {
            // No component is driving the MFA flow here, so end the session and
            // make them sign in again — where the challenge is enforced.
            await supabase.auth.signOut();
            setEmployee(null);
          }
        } else {
          setEmployee(null);
        }
      }
      setLoading(false);
    };
    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      (async () => {
        if (event === 'SIGNED_OUT') {
          clearStorageKeepingTrustedDevices(); // keep "remember this device" markers
          window.location.replace('/crm');
          return;
        }

        if (!session) return;

        // SIGNED_IN fires as soon as the PASSWORD succeeds — before any second
        // factor. Adopting the employee here would unmount CRMLogin and bypass
        // MFA entirely, so a privileged account is only adopted once the session
        // has actually reached aal2. CRMLogin owns the flow until then and calls
        // onLogin itself. MFA_CHALLENGE_VERIFIED covers the step-up.
        if (event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY' || event === 'MFA_CHALLENGE_VERIFIED') {
          const emp = await loadEmployee(session.user.id);
          if (!emp) { setEmployee(null); return; }
          try {
            if ((await evaluateMfaGate(emp)) !== 'ok') return; // leave CRMLogin in control
          } catch (err) {
            if (!isMfaUnavailable(err)) return; // only adopt when TOTP is simply off
          }
          setEmployee(emp);
        }
      })();
    });

    return () => subscription.unsubscribe();
  }, []);

  const navigate = (p: any, params?: Record<string, string>) => {
    setPageParams(params || {});
    if (typeof p === 'string') setPage(p as CRMPage);
    else if (p && p.page) setPage(p.page as CRMPage);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
        <LogoLoader size={52} />
      </div>
    );
  }

  if (!employee) {
    return <CRMLogin onLogin={emp => { setEmployee(emp); setPage('dashboard'); }} />;
  }

  // Force password change for new employees
  if (!employee.password_changed) {
    return <ChangePassword employee={employee} onComplete={updatedEmp => setEmployee(updatedEmp)} />;
  }

  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <Dashboard employee={employee} onNavigate={navigate} />;
      case 'leads': return <Leads employee={employee} onNavigate={navigate} pageParams={pageParams} />;
      case 'onboarding': return <ClientOnboarding employee={employee} onNavigate={navigate} pageParams={pageParams} />;
      case 'clients': return <ManageClients employee={employee} onNavigate={navigate} />;
      case 'portfolio': return <Portfolio employee={employee} onNavigate={navigate} pageParams={pageParams} />;
      case 'transactions': return <Transactions employee={employee} onNavigate={navigate} />;
      case 'reports': return <Reports employee={employee} />;
      case 'bonds': return <Bonds employee={employee} onNavigate={navigate} pageParams={pageParams} />;
      // Content Creation is visible to everyone — admins get the full studio,
      // employees get the read-only approved-content gallery (branched inside).
      case 'marketing_content': return <MarketingContent employee={employee} onNavigate={navigate} />;
      case 'documents': return <Documents employee={employee} initialClientId={pageParams.clientId} onBack={pageParams.clientId ? () => navigate('clients') : undefined} />;
      case 'admin_documents': return isAdmin ? <AdminDocuments employee={employee} /> : <Documents employee={employee} />;
      case 'mis': return <MIS employee={employee} />;
      // DSA Management (directory) and DSA Payout are employee-accessible; data
      // scope + RLS enforce the ownership model — a non-admin only sees the DSAs
      // assigned to them (nw_dsa.employee_id). Admin-only sub-actions stay gated
      // inside.
      case 'dsa_management': return <DSAManagement employee={employee} />;
      case 'dsa_payout': return <DSAPayout employee={employee} />;
      case 'employees': return isAdmin ? <Employees employee={employee} /> : <Dashboard employee={employee} onNavigate={navigate} />;
      case 'deal_confirmation': return <DealConfirmation employee={employee} />;
      case 'transfer_queue': return isAdmin ? <TransferQueue employee={employee} /> : <Dashboard employee={employee} onNavigate={navigate} />;
      case 'support_tickets': return <SupportTickets employee={employee} onNavigate={navigate} />;
      case 'settings': return <Settings employee={employee} />;
      default: return <Dashboard employee={employee} onNavigate={navigate} />;
    }
  };

  

  return (
    <Layout employee={employee} page={page} onNavigate={navigate}>
      {renderPage()}
    </Layout>
  );
}
