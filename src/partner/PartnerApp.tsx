import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { LogoLoader } from '../components/LogoLoader';
import { partnerSupabase } from '../lib/supabase';
import { SurfaceSetPinPrompt } from '../components/SurfaceSetPinPrompt';
import {
  PIN_PROMPT_LIMIT, hasSurfaceProfile, recordSurfacePinPromptSkip,
  silenceSurfacePinPrompt, surfacePinPromptSkips,
} from '../lib/pinDevice';
import { PartnerShell } from './layout/PartnerShell';
import { VIEW_TITLES } from './layout/navigation';
import { usePartnerRouter } from './routing/usePartnerRouter';
import { usePartnerSnapshot } from './hooks/usePartnerSnapshot';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { ClientsPage } from './features/clients/ClientsPage';
import { PayoutsPage } from './features/payouts/PayoutsPage';
import { ProfilePage } from './features/profile/ProfilePage';
import { ReferralPage } from './features/referral/ReferralPage';
import { SubmitLeadPage } from './features/referral/SubmitLeadPage';
import { LeadsPage } from './features/referral/LeadsPage';
import { ChangePasswordModal } from './features/profile/ChangePasswordModal';

interface PartnerAppProps {
  onLogout: () => void;
}

/**
 * Partner Portal root. Fetches one snapshot and derives every view from it, so
 * navigation never re-queries; only the per-client portfolio drill-down loads
 * lazily. Owns internal routing and leaves the host router in App.tsx untouched.
 */
export default function PartnerApp({ onLogout }: PartnerAppProps) {
  const { view, navigate } = usePartnerRouter();
  const [showChangePw, setShowChangePw] = useState(false);

  // Kill-switch: nw_current_dsa_id() embeds the enabled + active checks, so the
  // moment an RM disables the login or deactivates the DSA, the next RPC raises
  // and we sign the partner out — no waiting for the JWT to expire.
  const handleAccessRevoked = useCallback(() => {
    onLogout();
  }, [onLogout]);

  const { snapshot, loading, error, refresh } = usePartnerSnapshot(handleAccessRevoked);

  const hasData = !!snapshot.profile;

  // Offer a device PIN once, right after the first successful load.
  const [pinPromptOpen, setPinPromptOpen] = useState(false);
  const pinPromptDecided = useRef(false);
  const partner = snapshot.profile;
  useEffect(() => {
    if (pinPromptDecided.current || !partner) return;
    pinPromptDecided.current = true;
    const already = hasSurfaceProfile('partner', partner.dsa_id);
    const refused = surfacePinPromptSkips('partner', partner.dsa_id) >= PIN_PROMPT_LIMIT;
    if (!already && !refused) setPinPromptOpen(true);
  }, [partner]);

  const renderView = () => {
    if (loading && !hasData) return <LoadingState />;
    if (error) return <ErrorState message={error} onRetry={refresh} />;
    if (!hasData) return <LoadingState />;

    switch (view) {
      case 'dashboard':
        return <DashboardPage snapshot={snapshot} onNavigate={navigate} />;
      case 'clients':
        return <ClientsPage clients={snapshot.clients} />;
      case 'payouts':
        return <PayoutsPage payout={snapshot.payout} notes={snapshot.notes} />;
      case 'referral':
        return <ReferralPage referral={snapshot.referral} />;
      case 'submit-lead':
        return <SubmitLeadPage onSubmitted={refresh} />;
      case 'leads':
        return <LeadsPage leads={snapshot.leads} />;
      case 'profile':
        return (
          <ProfilePage profile={snapshot.profile} onChangePassword={() => setShowChangePw(true)} />
        );
      default:
        return <DashboardPage snapshot={snapshot} onNavigate={navigate} />;
    }
  };

  return (
    <>
      <PartnerShell
        view={view}
        title={VIEW_TITLES[view]}
        partner={snapshot.profile}
        refreshing={loading}
        onNavigate={navigate}
        onRefresh={refresh}
        onChangePassword={() => setShowChangePw(true)}
        onLogout={onLogout}
      >
        {renderView()}
      </PartnerShell>

      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}

      {pinPromptOpen && partner && (
        <SurfaceSetPinPrompt
          supabase={partnerSupabase}
          surface="partner"
          setFn="partner-pin-set"
          id={partner.dsa_id}
          name={partner.full_name}
          email={partner.email}
          manageHint="Profile"
          onSkip={() => { recordSurfacePinPromptSkip('partner', partner.dsa_id); setPinPromptOpen(false); }}
          onDone={() => { silenceSurfacePinPrompt('partner', partner.dsa_id); setPinPromptOpen(false); }}
        />
      )}
    </>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <LogoLoader size={52} />
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
