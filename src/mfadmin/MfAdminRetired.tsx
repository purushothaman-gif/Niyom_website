/**
 * What /mf-admin shows once mutual funds run on the MF platform (VITE_MF_SSO).
 * The in-house BSE StAR MF console (UCC, orders, mandates) would be a second
 * rail beside the platform, so it is switched off; the code stays for rollback.
 */
export default function MfAdminRetired() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-base px-4 text-text-primary">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold">The MF admin console has been retired</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Mutual fund registrations, orders and SIPs are now handled on the MF platform. Client
          records and portfolios remain in the CRM.
        </p>
        <a
          href="/crm"
          className="mt-5 inline-block rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent"
        >
          Go to the CRM
        </a>
      </div>
    </div>
  );
}
