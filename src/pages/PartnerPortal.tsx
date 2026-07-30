/**
 * PartnerPortal — thin mount point for the Niyom Wealth Partner Portal.
 * -----------------------------------------------------------------------------
 * The full experience (shell, dashboard, clients, payouts, services/hooks) lives
 * in the isolated `src/partner` feature tree, mirroring how `src/portal` backs
 * the client-facing ClientPortal. This wrapper keeps the host router in App.tsx
 * unaware of that structure.
 */
import PartnerApp from '../partner/PartnerApp';

interface Props {
  onLogout: () => void;
}

export default function PartnerPortal({ onLogout }: Props) {
  return <PartnerApp onLogout={onLogout} />;
}
