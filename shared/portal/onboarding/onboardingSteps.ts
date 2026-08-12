/**
 * Onboarding step model — the single source of truth for the client-facing
 * onboarding checklist and wizard. Completion is derived entirely from fields
 * on the client record (NWClient), because clients cannot read nw_documents.
 */
import type { NWClient } from '../../crm/types';

export interface ChecklistStep {
  key: string;
  label: string;
  done: boolean;
  /** Steps that don't apply to this client (e.g. CML) are hidden from the list. */
  applicable: boolean;
}

export const PRODUCTS = [
  { value: 'mutual_funds', label: 'Mutual Funds' },
  { value: 'bonds', label: 'Bonds' },
  { value: 'fixed_deposits', label: 'Fixed Deposits' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'unlisted_shares', label: 'Unlisted Shares' },
] as const;

/** Products that mandate a CML upload. Mirrors the submit edge function. */
export const CML_PRODUCTS = new Set(['bonds', 'unlisted_shares']);

/** The CML products an active client can activate after onboarding. */
export const ACTIVATABLE_PRODUCTS = [
  { value: 'bonds', label: 'Bonds' },
  { value: 'unlisted_shares', label: 'Unlisted Shares' },
] as const;

/** CML products this client hasn't enabled yet (empty ⇒ nothing left to add). */
export function activatableProducts(client: NWClient | null): string[] {
  const prefs = client?.investment_preferences || [];
  return ACTIVATABLE_PRODUCTS.map((p) => p.value).filter((p) => !prefs.includes(p));
}

/** Show the "Activate Bonds & Unlisted Shares" entry point once KYC is active. */
export function canActivateMoreProducts(client: NWClient | null): boolean {
  return client?.onboarding_status === 'active' && activatableProducts(client).length > 0;
}

export function cmlRequiredFor(prefs: string[]): boolean {
  return prefs.some((p) => CML_PRODUCTS.has(p));
}

export function buildChecklist(client: NWClient | null): ChecklistStep[] {
  const c = client;
  const cmlRequired = !!c?.cml_required;
  const approved = c?.verification_status === 'verified';
  return [
    { key: 'account', label: 'Account Created', done: !!c, applicable: true },
    { key: 'mobile', label: 'Mobile Verified', done: !!c?.phone_verified, applicable: true },
    { key: 'pan', label: 'PAN Verification', done: !!c?.pan_verified, applicable: true },
    { key: 'bank', label: 'Bank Verification', done: !!c?.bank_verified, applicable: true },
    { key: 'cml', label: 'Demat Proof (CML)', done: !!c?.cml_uploaded, applicable: cmlRequired },
    { key: 'rm', label: 'RM Approval', done: approved, applicable: true },
    { key: 'ready', label: 'Ready to Invest', done: c?.onboarding_status === 'active', applicable: true },
  ];
}

export function checklistProgress(steps: ChecklistStep[]): { done: number; total: number; percent: number } {
  const applicable = steps.filter((s) => s.applicable);
  const done = applicable.filter((s) => s.done).length;
  const total = applicable.length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

/** Whether the client still has onboarding work to show on the dashboard. */
export function onboardingIncomplete(client: NWClient | null): boolean {
  return !!client && client.onboarding_status !== 'active';
}

/** True once the client has submitted KYC and is awaiting RM approval. */
export function kycUnderReview(client: NWClient | null): boolean {
  return client?.onboarding_status === 'kyc_under_review' || client?.onboarding_status === 'kyc_submitted';
}
