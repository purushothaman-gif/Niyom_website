# MF data from registrar mailback feeds — plan

**Goal.** Bring every mutual fund holding and transaction under ARN-362707
into Niyom, from the same CAMS and KFintech feeds the MF platform receives.
The CRM and client portal can then show MF beside bonds, shares and the rest,
without depending on an API from the platform.

**Status:** draft for review. Nothing is built yet.

## Source feeds

These reports come into purushothaman@niyomwealth.com every day. They are
already forwarded to the MF platform.

| Registrar | Report | What it gives | Format |
|---|---|---|---|
| CAMS | WBR2 Investor Transactions for a Period | Every purchase, redemption, switch, SIP instalment, dividend: folio, PAN, scheme, ISIN, units, NAV, amount, date, txn type | Encrypted ZIP → DBF |
| CAMS | WBR9 Investor Static details (CRMS) | Folio master: holder names, PAN, bank, nominee, address | Encrypted ZIP → DBF |
| CAMS | WBR49 SIP/STP procured | SIP/STP registrations: amount, frequency, start/end, status | Encrypted ZIP → DBF |
| KFintech | Transaction Feeds Report (WBTRN) | Same role as WBR2 for KFintech-serviced AMCs | Attachment or link when there is data |
| KFintech | Investor Master Information (WBMST) | Same role as WBR9 | Same |
| KFintech | Subscribed SIP Registrations (WSREG) | Same role as WBR49 | Same |

Between them, CAMS and KFintech service nearly every AMC, so the feeds cover
the whole book. Empty windows send a "No data" email with no attachment, and
the importer just logs and skips those.

Run `bash scripts/mf-rta-peek.sh <zip>` to read a feed's layout; it prints the
columns only and never any client data. The password is entered at a hidden
prompt and is never stored in the repo or pasted anywhere.

### CAMS WBR9 — confirmed layout (captured 2026-11-03)

The WBR9 file is a single DBF, one row per scheme-folio. It is richer than a
plain static feed: `CLOS_BAL` and `RUPEE_BAL` make it a holdings snapshot as
well as a folio master, so a daily WBR9 alone yields current MF holdings — no
transaction history needed for a net-worth view (transactions still need WBR2).

Columns that matter for the importer (full list has 103 fields incl. three
nominee blocks and CKYC/Aadhaar KYC fields we do not need):

| DBF column | Type(w) | Maps to |
|---|---|---|
| `FOLIOCHK` | C(20) | folio number |
| `AMC_CODE` | C(3) | AMC code |
| `PRODUCT` | C(8) | scheme / product code |
| `SCH_NAME` | C(100) | scheme name |
| `INV_NAME` | C(70) | first holder name |
| `PAN_NO` | C(45) | first holder PAN — **client match key** |
| `JNT_NAME1`/`JNT_NAME2` | C(70) | joint holder names |
| `JOINT1_PAN`/`JOINT2_PAN`/`GUARD_PAN` | C(45) | other-holder PANs |
| `CLOS_BAL` | N(19,6) | units held (→ `mf_rta_holdings.units`) |
| `RUPEE_BAL` | N(19,6) | value at `REP_DATE` |
| `REP_DATE` | D(8) | snapshot date (YYYYMMDD) |
| `FOLIO_DATE` | D(8) | folio open date |
| `TAX_STATUS` | C(35) | holding pattern / tax status |
| `BROKER_COD`/`BROKCODE`/`SUBBROKER` | C | ARN / sub-broker (expect ARN-362707) |
| `EMAIL`/`MOBILE_NO` | C | contact (server-side only) |
| `DP_ID`/`DEMAT` | C | demat linkage |

Notes:
- No ISIN column, so NAV lookup in `nav_daily` must join by scheme/AMC code,
  not ISIN. Keep a `PRODUCT`+`AMC_CODE` → ISIN map (reuse the CAS scheme map).
- `RUPEE_BAL` already gives the registrar's valuation, so reconciliation can
  compare our NAV×units against `RUPEE_BAL` row-by-row — no separate AUM report
  needed for the holdings check (still request WBR2 for the transaction audit).
- Still to capture from real files with data: **WBR2** (transactions),
  **WBR49** (SIP/STP), and the three KFintech reports. These returned "No data"
  for the short recent window; get them from the one-time history pull.

## Design

1. **Intake.** There are two phases, and both use the same parser.
   - **Phase 1:** a CRM page, *MF Feeds* (admin only). It uploads a mailback ZIP,
     and the server unpacks it with the stored password. This needs no mailbox
     plumbing, works from day one, and is how the one-time history load is done.
   - **Phase 2:** automatic. A Gmail filter copies these emails to a dedicated
     ingest mailbox, and a scheduled job reads new messages through the
     Gmail API (Workspace service account, read-only on that one mailbox).
     It fetches attachments, follows KFintech links, and feeds the same parser.
     Every message ID is recorded, so nothing is imported twice.
2. **Parse.** Use one DBF reader with a column map per report, in the style of
   the CAS `amfiColumns.ts` layout. Raw rows are kept in staging tables
   exactly as received, together with the source file name, the request ID
   and a hash.
3. **Load into separate tables.** Keep this data apart from the old in-house MF
   data, which stays hidden behind `VITE_MF_SSO`, so nothing is counted twice.
   - `mf_rta_folios`: folio, AMC, PAN, holder, registrar, linked `client_id`
   - `mf_rta_transactions`: one row per registrar transaction. The key is
     registrar + folio + scheme + transaction number, so re-loads are safe.
   - `mf_rta_sips`: SIP/STP registrations
   - `mf_rta_holdings`: derived. For each folio and scheme it holds units,
     cost (FIFO, using the capital-gains engine), the latest NAV from
     `nav_daily` by ISIN, and value.
   - `mf_rta_import_log`: one row per file, with counts, errors and duration.
4. **Match to clients by PAN.** Match on the first holder's PAN. Folios that
   match no client go to an *Unmatched folios* list in the CRM, where an admin
   can map them or create the client.
5. **Reconcile.** After each load, compare the derived units per folio and
   scheme with the registrar's own holdings/AUM report (requested monthly).
   Any difference raises an alert, as the CAS import already does.
6. **Show the data.**
   - **CRM:** MF holdings and transactions per client, AUM by RM/partner, and
     SIP book.
   - **Client portal and partner portal:** MF holdings in net worth and
     allocation, labelled only with Niyom and AMC/scheme names, never the
     platform's.
   - **Admin view:** feed health, meaning the date of the last file per
     report. A feed that stops silently can go unnoticed for days, as the
     NAV feed once did, so a missing day raises an alert.

## Security

- The mailback ZIP password is stored as a server secret only. It is entered
  through a hidden-input setup script, as was done for the MF platform keys.
- Staging and RTA tables have RLS: admins see everything, and an RM sees only
  their own clients. Clients read their own data through the existing portal
  functions. Nothing is granted to `anon`.
- PAN, bank and address fields stay in the server-side tables and never go
  to the browser beyond what each screen needs.
- Raw ZIPs are not kept after parsing. The staging rows plus the file hash
  are enough for an audit.

## Before building

1. **One-time history pull.** Request CAMS WBR2 and the KFintech transaction
   feed from ARN registration to today, plus a current holdings/AUM report
   from each.
2. **Mailback password.** You enter it as a secret.
3. **Ingest mailbox for phase 2.** Pick a mailbox (for example
   mf-feeds@niyomwealth.com) and grant Workspace read access to it.
4. **Sample files.** One ZIP of each report type with data in it, to fix
   the column maps.

## Build order

1. Write the DBF reader and the column maps, with tests against the sample
   files' layouts.
2. Add the migrations (the `mf_rta_*` tables, RLS, the import log), then
   `gen:types`.
3. Build the CRM *MF Feeds* upload page and run the history load.
4. Add derived holdings, PAN matching, the unmatched-folio list and
   reconciliation.
5. Build the CRM views, then the portal and partner views (behind a switch,
   off until checked).
6. Phase 2: automatic mailbox intake and feed-health alerts.
