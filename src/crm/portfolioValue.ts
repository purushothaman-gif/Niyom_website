import { supabase } from '../lib/supabase';
import { mfSsoEnabled } from '../../shared/platform/env';

/**
 * Recompute and store nw_clients.portfolio_value — the AUM figure the CRM
 * dashboard, client lists and reports read.
 *
 * Once mutual funds run on the MF platform (VITE_MF_SSO), the platform is the
 * MF record, so our older mutual fund rows are left out of the figure; they
 * stay in nw_holdings untouched. The one-off backfill of every client at
 * cutover is in docs/mf-platform-cutover.md.
 */
export async function recalcPortfolioValue(clientId: string): Promise<void> {
  const { data } = await supabase
    .from('nw_holdings')
    .select('current_value, product_type')
    .eq('client_id', clientId);
  const excludeMf = mfSsoEnabled();
  const total = (data || [])
    .filter((h) => !excludeMf || h.product_type !== 'mutual_fund')
    .reduce((s, h) => s + (h.current_value || 0), 0);
  await supabase.from('nw_clients').update({ portfolio_value: total }).eq('id', clientId);
}
