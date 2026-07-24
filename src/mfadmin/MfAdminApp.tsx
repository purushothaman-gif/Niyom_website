/**
 * MfAdminApp — the NIYOM Mutual Fund Admin Portal (employee-facing).
 * -----------------------------------------------------------------------------
 * A completely custom NIYOM console over BSE StAR MF, so staff never open BSE's
 * own interface. Mounted additively at /mf-admin, isolated in src/mfadmin.
 *
 * AUTH: the console has its OWN sign-in (MfAdminLogin) — maintained separately
 * from the CRM — against the shared employee backend (Supabase auth +
 * nw_employees + TOTP gate for privileged roles). Restoring a stored session
 * re-checks the second factor exactly like the CRM shell does, so a half-
 * finished privileged login can never slip past MFA. Sign-out stays on
 * /mf-admin (back to this console's login), never bouncing through the CRM.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { NWEmployee } from '../crm/types';
import { evaluateMfaGate, isMfaUnavailable, clearStorageKeepingTrustedDevices } from '../crm/mfa';
import MfAdminLogin from './MfAdminLogin';
import { AdminShell } from './layout/AdminShell';
import { ADMIN_VIEW_TITLES } from './layout/adminNav';
import { useAdminRouter } from './routing/useAdminRouter';
import { useAdminDashboard } from './hooks/useAdminDashboard';
import { AdminDashboardPage } from './features/dashboard/AdminDashboardPage';
import { AdminPlaceholder } from './features/AdminPlaceholder';

export default function MfAdminApp() {
  const [employee, setEmployee] = useState<NWEmployee | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    // Restore an existing session — with the same MFA re-check the CRM does.
    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        const { data } = await supabase
          .from('nw_employees')
          .select('*')
          .eq('auth_user_id', session.user.id)
          .eq('status', 'active')
          .maybeSingle();
        const emp = (data as NWEmployee) || null;
        if (emp) {
          let gate: Awaited<ReturnType<typeof evaluateMfaGate>>;
          try {
            gate = await evaluateMfaGate(emp);
          } catch (err) {
            gate = isMfaUnavailable(err) ? 'ok' : 'challenge';
          }
          if (!alive) return;
          if (gate === 'ok') {
            setEmployee(emp);
          } else {
            // Incomplete second factor — end the session; the login enforces it.
            await supabase.auth.signOut();
            setEmployee(null);
          }
        } else if (alive) {
          setEmployee(null);
        }
      }
      if (alive) setLoading(false);
    };
    void checkSession();

    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <FullScreen>
        <Spinner />
      </FullScreen>
    );
  }

  if (!employee) return <MfAdminLogin onLogin={setEmployee} />;

  return <AdminConsole employee={employee} />;
}

function AdminConsole({ employee }: { employee: NWEmployee }) {
  const { view, navigate } = useAdminRouter();
  const { data, loading, error, refresh } = useAdminDashboard();

  const logout = async () => {
    await supabase.auth.signOut();
    clearStorageKeepingTrustedDevices(); // keep "remember this device" markers
    window.location.replace('/mf-admin');
  };

  const renderView = () => {
    if (view === 'dashboard') {
      if (loading && !data) return <Spinner />;
      if (error) return <ErrorState message={error} onRetry={refresh} />;
      if (data) return <AdminDashboardPage data={data} />;
      return <Spinner />;
    }
    return <AdminPlaceholder title={ADMIN_VIEW_TITLES[view]} />;
  };

  return (
    <AdminShell
      view={view}
      title={ADMIN_VIEW_TITLES[view]}
      employee={employee}
      refreshing={loading}
      onNavigate={navigate}
      onRefresh={refresh}
      onLogout={logout}
    >
      {renderView()}
    </AdminShell>
  );
}

function FullScreen({ children }: { children: ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-bg-base">{children}</div>;
}

function Spinner() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
        style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
      />
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-danger" />
      <p className="text-sm text-text-primary">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-token-md border border-border bg-bg-surface px-4 py-2 text-xs font-semibold text-text-primary hover:text-accent"
      >
        Try again
      </button>
    </div>
  );
}
