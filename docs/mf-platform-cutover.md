# MF platform cutover

Mutual funds move to the external, white-labelled MF platform. Our own MF tools
retire behind one switch, so the live site does not change until cutover day.
**White-label rule:** the platform's name never appears in anything a client,
partner or RM sees.

## What the switch does

| Switch | Where | Effect when `true` |
|---|---|---|
| `VITE_MF_SSO` | Vercel | Client **Mutual Funds** opens the platform (SSO, new tab). In-house MF retires across client portal, partner portal, CRM and `/mf-admin`. |
| `EXPO_PUBLIC_MF_SSO` | mobile build | Same for the app: the Invest tab opens the platform; the SIP tab, fund, order, gains and import screens redirect to it. |
| `VITE_MF_SSO_STAFF` / `EXPO_PUBLIC_MF_SSO_STAFF` | Vercel / mobile | Shows the admin/partner "MF Platform" entries. Keep **off** until the platform has a staff/partner SSO spec. |

Retired while `VITE_MF_SSO` is on (the code stays in place for rollback):

- **Client:**
  - Our MF holdings, MF transactions and CAS statements are left out of net worth, allocation, returns, reports and exports.
  - The SIP page and capital gains are gone, along with statement-import prompts and BSE SIP alerts.
  - The dashboard MF card and quick actions now just open the platform. The FAQs are rewritten.
- **Partner:** client totals use `nw_partner_clients_excluding_mf`, and the client drill-downs leave out MF rows.
- **CRM:**
  - Portfolio hides MF holdings, the MF column and the CAS panel, and no new MF holdings can be added.
  - The Transactions form no longer offers Mutual Fund. Past MF transactions stay visible, and MIS trail and MF/SIP incentives still read them.
  - Reports leave out MF holdings.
  - The BSE readiness badge and filter are hidden, and gender is optional.
  - `portfolio_value` recalculations leave out MF.
- **`/mf-admin`:** shows a "retired" page.

Not changed: the CRM fund research page (marketing factsheets), the public MF
research pages, and the backend MF data jobs that feed them.

## Cutover steps

1. Run `bash scripts/mf-sso-prod-setup.sh` yourself (production API base:
   `https://api.wylth.com`). It asks for the API key, secret key and IV with
   hidden input, tests them with a mapped PAN, then stores them as Supabase
   secrets and switches the function off mock. Use it again to rotate keys.
2. Test SSO end to end with a client whose PAN the platform has mapped.
3. Set `VITE_MF_SSO=true` on Vercel and redeploy.
4. **Same day**, backfill the stored AUM so the CRM dashboard, client lists and
   reports drop MF everywhere at once, not only for clients edited afterwards:

   ```sql
   UPDATE nw_clients c
   SET portfolio_value = COALESCE((
     SELECT SUM(h.current_value) FROM nw_holdings h
     WHERE h.client_id = c.id AND h.product_type <> 'mutual_fund'
   ), 0);
   ```

5. Ship a mobile build or OTA update with `EXPO_PUBLIC_MF_SSO=true`.

## Rollback

Set `VITE_MF_SSO=false` and redeploy. Then re-run the backfill without the
`product_type <> 'mutual_fund'` condition so `portfolio_value` includes MF again.
No MF data was deleted.
