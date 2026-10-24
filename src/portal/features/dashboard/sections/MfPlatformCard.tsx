import { ExternalLink, ShieldCheck, TrendingUp } from 'lucide-react';
import { Card } from '../../../components/Card';
import { SectionHeader } from '../../../components/SectionHeader';

/**
 * The dashboard's mutual fund card once mutual funds run on the MF platform.
 * No figures: the platform is the record, so this card only opens it (the click
 * goes through PortalApp's navigate, which starts the SSO hand-off).
 */
export function MfPlatformCard({ onOpen }: { onOpen: () => void }) {
  return (
    <Card className="animate-fadeInUp animate-delay-200">
      <SectionHeader title="Mutual Funds" icon={TrendingUp} />
      <p className="text-sm text-text-secondary">
        View your mutual fund holdings, invest, start a SIP, redeem or switch — all in your mutual
        fund account.
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-text-faint">
        <ShieldCheck className="h-3.5 w-3.5" /> Opens in a new tab · no separate sign-in
      </p>
      <button
        type="button"
        onClick={onOpen}
        className="mt-4 inline-flex items-center gap-2 rounded-token-md bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent hover:bg-accent-strong"
      >
        <ExternalLink className="h-4 w-4" /> Open Mutual Funds
      </button>
    </Card>
  );
}
