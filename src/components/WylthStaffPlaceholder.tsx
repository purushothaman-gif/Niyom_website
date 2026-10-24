import { TrendingUp } from 'lucide-react';

/**
 * Admin / partner Mutual Funds entry. Mutual funds run on Wylth, but Wylth's
 * SSO spec (v1.0) covers investors only — there is no staff or distributor
 * sign-in to hand off to yet. Hidden behind VITE_WYLTH_STAFF until there is.
 */
export function WylthStaffPlaceholder() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <TrendingUp className="mx-auto mb-4 h-9 w-9 text-accent" />
      <h2 className="text-base font-semibold text-text-primary">Mutual funds on Wylth</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-text-secondary">
        One-click sign-in to Wylth for this login is coming soon. Clients already open their mutual
        fund account from the Mutual Funds tab in their portal.
      </p>
    </div>
  );
}
