import React, { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { edgeFunctionErrorMessage } from '../lib/edgeFunctionError';
import { NWEmployee, NWTransaction, NWClient, NWDSA, NWDSADebitNote } from './types';
import { fmt, PRODUCT_LABELS } from './utils';
import { Wallet, Download, ChevronDown, FileText, RefreshCw, Loader2, FileCheck2, CheckCircle2, XCircle, Eye, Send, Lock, FileArchive } from 'lucide-react';
import JSZip from 'jszip';
import { generateDebitNotePdfBlob, DebitNoteParticular, computePayoutTds } from './dsaDebitNote';
import { asJson } from '../lib/dbJson';

const DEBIT_NOTE_BUCKET = 'dsa-debit-notes';

type StageStyle = { label: string; bg: string; color: string; border: string };

// Combined lifecycle stage derived from payment `status` + `signature_status`:
//   Generated → Sent for Signature → Viewed → Signed → Paid   (Cancelled is terminal)
function deriveStage(note: NWDSADebitNote): StageStyle {
  if (note.status === 'cancelled') return { label: 'Cancelled', bg: 'rgba(239,68,68,0.12)', color: 'rgb(var(--danger-soft-rgb))', border: 'rgba(239,68,68,0.4)' };
  if (note.status === 'paid') return { label: 'Paid', bg: 'rgba(16,185,129,0.12)', color: 'var(--success)', border: 'rgba(16,185,129,0.4)' };
  switch (note.signature_status) {
    case 'signed': return { label: 'Signed', bg: 'rgba(52,211,153,0.12)', color: 'rgb(var(--success-soft-rgb))', border: 'rgba(52,211,153,0.4)' };
    case 'viewed': return { label: 'Viewed', bg: 'rgba(96,165,250,0.12)', color: 'rgb(var(--info-soft-rgb))', border: 'rgba(96,165,250,0.4)' };
    case 'sent': return { label: 'Sent for Signature', bg: 'rgba(168,139,250,0.12)', color: 'rgb(var(--c-violet-rgb))', border: 'rgba(168,139,250,0.4)' };
    default: return { label: 'Generated', bg: 'rgba(var(--accent-rgb),0.12)', color: 'var(--accent)', border: 'rgba(var(--accent-rgb),0.4)' };
  }
}

const fmtDateTime = (d: string | null) => d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true }) : null;

interface Props { employee: NWEmployee; }

interface PayoutRow {
  txn_id: string;      // source transaction — recorded on the debit note it lands in
  dsa_id: string;
  dsa_code: string;
  dsa_name: string;
  client_id: string;
  client_name: string;
  client_code: string;
  product_type: string;
  product_name: string;
  quantity: number;
  dsa_price: number;
  client_price: number;
  payout: number;
}

interface DSAGroup {
  dsa_id: string;
  dsa_code: string;
  dsa_name: string;
  rows: PayoutRow[];
  total: number;
}

const DSA_PRICE_TYPES = ['unlisted_share', 'secondary_bond', 'primary_bond'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export default function DSAPayout({ employee }: Props) {
  const today = new Date();
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth());
  const [groups, setGroups] = useState<DSAGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [empList, setEmpList] = useState<{ id: string; full_name: string; employee_code: string }[]>([]);
  const [empFilter, setEmpFilter] = useState('all');

  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';
  const years = Array.from({ length: 5 }, (_, i) => today.getFullYear() - i);

  React.useEffect(() => {
    if (!isAdmin) return;
    supabase.from('nw_employees').select('id, full_name, employee_code').eq('status', 'active').order('full_name')
      .then(({ data }) => setEmpList((data as any[]) || []));
  }, [isAdmin]);

  function getLastDay(year: number, month: number): number {
    return new Date(year, month + 1, 0).getDate();
  }

  const startDate = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-01`;
  const endDate = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(getLastDay(selectedYear, selectedMonth)).padStart(2, '0')}`;

  const calculate = useCallback(async () => {
    setLoading(true);

    // Fetch clients with DSA mapping.
    let clientQuery = supabase
      .from('nw_clients')
      .select('id, full_name, client_code, employee_id, sourced_via, dsa_id, dsa:nw_dsa(id, dsa_code, full_name)')
      .eq('sourced_via', 'dsa');
    if (!isAdmin) {
      // Employee login only: scope to the DSAs assigned to this employee
      // (nw_dsa.employee_id). Resolve the owned DSA ids, then restrict the client
      // mapping to those DSAs. Admin logic below is left exactly as before.
      const { data: ownedDsas } = await supabase.from('nw_dsa').select('id').eq('employee_id', employee.id);
      const ownedDsaIds = (ownedDsas as { id: string }[] | null)?.map(d => d.id) || [];
      if (ownedDsaIds.length === 0) { setGroups([]); setLoading(false); setHasLoaded(true); return; }
      clientQuery = clientQuery.in('dsa_id', ownedDsaIds);
    } else if (empFilter !== 'all') {
      clientQuery = clientQuery.eq('employee_id', empFilter);
    }
    const { data: clientData } = await clientQuery;
    /*
     * The columns this query actually selects, not a whole NWClient — it asks
     * for six and NWClient has 30-odd. Two-step cast because supabase-js infers
     * the embedded `dsa` as an ARRAY without generated Database types, while
     * PostgREST returns an object for a many-to-one FK; every use below reads
     * it as an object (client.dsa.full_name), which is the correct shape.
     */
    type DsaClient = Pick<NWClient, 'id' | 'full_name' | 'client_code' | 'employee_id'> & {
      sourced_via: string | null;
      dsa_id: string | null;
      dsa: NWDSA | null;
    };
    const dsaClients = ((clientData as unknown as DsaClient[]) || []);

    if (dsaClients.length === 0) { setGroups([]); setLoading(false); setHasLoaded(true); return; }

    const clientIds = dsaClients.map(c => c.id);

    // DSA payout is computed from the underlying transactions, which carry the
    // buy/sell direction (holdings do not). DSA-priced products in the period:
    //   BUY:  (client_price − dsa_price) × qty
    //   SELL: (dsa_price − client_price) × qty   (direction reversed)
    const { data: txnData } = await supabase
      .from('nw_transactions')
      .select('*')
      .in('client_id', clientIds)
      .in('product_type', DSA_PRICE_TYPES)
      .gte('txn_date', startDate)
      .lte('txn_date', endDate);

    const txns = (txnData as NWTransaction[]) || [];

    const rows: PayoutRow[] = [];
    // Audit trail of transactions excluded by the period safety guard below.
    const skippedOutOfPeriod: { id: string; dsa: string; txn_date: string; selected_month: string; reason: string }[] = [];
    const selectedMonthLabel = `${MONTHS[selectedMonth]} ${selectedYear}`;

    for (const t of txns) {
      const client = dsaClients.find(c => c.id === t.client_id);

      // Period safety guard — runs before any debit note is built. Even though
      // the query already filters by txn_date, re-verify each transaction's
      // txn_date falls within the selected month. This defends against
      // historical/data inconsistencies and never silently lets a transaction
      // from another month into a debit note; only validated rows flow onward.
      const txnDate = t.txn_date || '';
      if (txnDate < startDate || txnDate > endDate) {
        const dsaLabel = client?.dsa ? `${client.dsa.full_name} (${client.dsa.dsa_code})` : `client ${t.client_id}`;
        const reason = `txn_date ${txnDate || 'null'} outside selected period ${startDate}..${endDate}`;
        skippedOutOfPeriod.push({ id: t.id, dsa: dsaLabel, txn_date: txnDate, selected_month: selectedMonthLabel, reason });
        console.warn(`[DSAPayout] Excluded out-of-period transaction — id=${t.id}, DSA=${dsaLabel}, txn_date=${txnDate || 'null'}, selectedMonth=${selectedMonthLabel}, reason=${reason}`);
        continue;
      }

      const dsaPrice = t.dsa_price;
      const clientPrice = t.client_price;
      if (dsaPrice == null || clientPrice == null) continue;

      const qty = t.quantity || 0;
      const payout = t.txn_type === 'sell'
        ? (dsaPrice - clientPrice) * qty
        : (clientPrice - dsaPrice) * qty;

      if (!client || !client.dsa) continue;

      rows.push({
        txn_id: t.id,
        dsa_id: client.dsa.id,
        dsa_code: client.dsa.dsa_code,
        dsa_name: client.dsa.full_name,
        client_id: client.id,
        client_name: client.full_name,
        client_code: client.client_code,
        product_type: t.product_type,
        product_name: t.product_name,
        quantity: qty,
        dsa_price: dsaPrice,
        client_price: clientPrice,
        payout,
      });
    }

    if (skippedOutOfPeriod.length > 0) {
      console.warn(`[DSAPayout] ${skippedOutOfPeriod.length} transaction(s) excluded from ${selectedMonthLabel} payout (txn_date out of period):`, skippedOutOfPeriod);
    }

    // Exclude transactions already covered by an ACTIVE (non-cancelled) debit
    // note, so the pending view only shows UNCOVERED payouts. This is what
    // stops a later payout merging into — or being stranded behind — a note that
    // already exists (paid/signed included).
    const { data: coveredLines } = await supabase
      .from('dsa_debit_note_lines')
      .select('transaction_id, debit_note:dsa_debit_notes!inner(status)')
      .neq('debit_note.status', 'cancelled');
    const coveredTxnIds = new Set((coveredLines || []).map((l: any) => l.transaction_id));

    // Group the remaining (uncovered) rows by DSA for batching into a note.
    const dsaMap = new Map<string, DSAGroup>();
    for (const r of rows) {
      if (coveredTxnIds.has(r.txn_id)) continue;
      if (!dsaMap.has(r.dsa_id)) {
        dsaMap.set(r.dsa_id, {
          dsa_id: r.dsa_id,
          dsa_code: r.dsa_code,
          dsa_name: r.dsa_name,
          rows: [],
          total: 0,
        });
      }
      const g = dsaMap.get(r.dsa_id)!;
      g.rows.push(r);
      g.total += r.payout;
    }

    setGroups(Array.from(dsaMap.values()));
    setLoading(false);
    setHasLoaded(true);
  }, [selectedYear, selectedMonth, empFilter, isAdmin, employee.id, startDate, endDate]);

  const totalPayout = groups.reduce((s, g) => s + g.total, 0);
  // Fixed 2% TDS applied to every payout → net total actually payable.
  const totalTds = computePayoutTds(totalPayout).tds;
  const totalNet = totalPayout - totalTds;

  // ---------- Debit Note state ----------
  const month = selectedMonth + 1; // 1-12
  const [debitNotes, setDebitNotes] = useState<NWDSADebitNote[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState('');
  const [regenDsaId, setRegenDsaId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<NWDSADebitNote | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState('');
  const [payTarget, setPayTarget] = useState<NWDSADebitNote | null>(null);
  const [payDate, setPayDate] = useState('');
  const [payRef, setPayRef] = useState('');
  const [payError, setPayError] = useState('');

  /** How many transactions a note covers. PostgREST returns the embedded
   *  aggregate as [{ count: n }]; older notes raised before
   *  dsa_debit_note_lines existed (pre-20260718100000) have none. */
  const noteLineCount = (note: NWDSADebitNote) => note.dsa_debit_note_lines?.[0]?.count ?? 0;

  // Period totals = still-pending payouts (groups) PLUS the period's already-
  // generated ACTIVE notes (debitNotes excludes cancelled). The top cards show
  // the WHOLE period so a fully-generated month isn't blank; `totalPayout` above
  // remains the "still to generate" figure, surfaced as a separate indicator.
  const genGross = debitNotes.reduce((s, n) => s + Number(n.payout_amount || 0), 0);
  const genTds = debitNotes.reduce((s, n) => s + Number(n.tds_amount || 0), 0);
  const genNet = debitNotes.reduce((s, n) => s + Number(n.net_payable_amount || 0), 0);
  const genEntries = debitNotes.reduce(
    (s, n) => s + (noteLineCount(n) || ((n as any).pdf_snapshot?.particulars?.length ?? 0)),
    0,
  );
  const pendingEntries = groups.reduce((s, g) => s + g.rows.length, 0);
  const periodGross = totalPayout + genGross;
  const periodTds = totalTds + genTds;
  const periodNet = totalNet + genNet;
  const periodEntries = pendingEntries + genEntries;
  const periodDsaIds = new Set<string>();
  groups.forEach((g) => periodDsaIds.add(g.dsa_id));
  debitNotes.forEach((n) => { const id = (n as any).dsa_id; if (id) periodDsaIds.add(id); });
  const periodDsas = periodDsaIds.size;

  const loadDebitNotes = useCallback(async () => {
    // Monthly payout is grouped by DATE OF PAYMENT: a PAID note counts in the
    // month it was marked paid (paid_at), regardless of its deal month — e.g. a
    // note for June work paid on 2 Jul belongs to July. A note not yet paid has
    // no payment date, so it stays under its deal month (year/month) until paid,
    // then moves to the payment month.
    //
    // Bucketing is done in JS (the note set is small) rather than a PostgREST
    // timestamp OR-filter, which did not filter reliably. The payment month is
    // read in IST (+05:30, the business timezone) so a payment entered as a
    // business date is never pushed into an adjacent month by UTC drift.
    const { data } = await supabase
      .from('dsa_debit_notes')
      // dsa_debit_note_lines(count) tells the row whether Regenerate is possible:
      // regenerateOne rebuilds from the note's own lines, so a note with none
      // cannot be regenerated at all.
      .select('*, dsa:nw_dsa(full_name, dsa_code), paid_by_employee:nw_employees!paid_by(full_name), cancelled_by_employee:nw_employees!cancelled_by(full_name), dsa_debit_note_lines(count)')
      // Cancelled notes are retained for audit but excluded from the listing.
      .neq('status', 'cancelled')
      // Most recent first. debit_note_number breaks ties for notes generated in
      // the same instant (bulk generate writes several rows).
      .order('created_at', { ascending: false })
      .order('debit_note_number', { ascending: false });

    const all = (data as NWDSADebitNote[]) || [];
    const inMonth = all.filter((n) => {
      const paidAt = (n as any).paid_at as string | null;
      if (n.status === 'paid' && paidAt) {
        // paid_at is stored UTC; shift +5:30 and read the IST calendar month.
        const ist = new Date(new Date(paidAt).getTime() + 5.5 * 3600 * 1000);
        return ist.getUTCFullYear() === selectedYear && ist.getUTCMonth() + 1 === month;
      }
      return (n as any).year === selectedYear && (n as any).month === month;
    });
    setDebitNotes(inMonth);
  }, [selectedYear, month]);

  React.useEffect(() => { loadDebitNotes(); }, [loadDebitNotes]);

  // Generate (or regenerate) a debit note for a single DSA group
  async function generateForGroup(g: DSAGroup, existing: NWDSADebitNote | undefined) {
    // Full DSA details for the PDF (bank, pan, address, etc.)
    const { data: dsaData } = await supabase.from('nw_dsa').select('*').eq('id', g.dsa_id).single();
    const dsa = dsaData as NWDSA;
    if (!dsa) throw new Error(`DSA ${g.dsa_code} not found`);

    // Reuse the existing number on regenerate, else mint a new one
    let number = existing?.debit_note_number;
    if (!number) {
      const { data: num, error: numErr } = await supabase.rpc('nw_generate_debit_note_number', {
        p_year: selectedYear, p_month: month,
      });
      if (numErr) throw numErr;
      number = num as string;
    }

    const particulars: DebitNoteParticular[] = g.rows.map(r => ({
      client_name: r.client_name,
      client_code: r.client_code,
      product_type: r.product_type,
      product_name: r.product_name,
      quantity: r.quantity,
      payout: r.payout,
    }));

    // Fixed 2% TDS on the gross payout → net amount actually paid out.
    const { gross, tds, net } = computePayoutTds(g.total);

    // Single document date shared by the rendered PDF and the snapshot, so the
    // signed copy (rebuilt from the snapshot) is byte-for-byte equivalent.
    const documentDate = new Date();
    const noteInput = {
      debitNoteNumber: number!,
      date: documentDate,
      month, year: selectedYear,
      dsa, particulars, total: gross,
      tdsAmount: tds, netPayable: net,
      generatedBy: employee.full_name,
    };

    const blob = await generateDebitNotePdfBlob(noteInput);

    const path = `${selectedYear}/${String(month).padStart(2, '0')}/${number}.pdf`;
    const { error: upErr } = await supabase.storage
      .from(DEBIT_NOTE_BUCKET)
      .upload(path, blob, { upsert: true, contentType: 'application/pdf' });
    if (upErr) throw upErr;

    // Immutable render snapshot (serializable DebitNoteInput) — lets the public
    // signing page rebuild the identical document and embed the DSA signature
    // without recomputing any payout/TDS values.
    const pdf_snapshot = {
      debitNoteNumber: number,
      dateISO: documentDate.toISOString(),
      month, year: selectedYear,
      dsa, particulars,
      total: gross, tdsAmount: tds, netPayable: net,
      generatedBy: employee.full_name,
    };

    // `existing` is only ever an ACTIVE (non-cancelled) note — a cancelled note
    // is an immutable audit record and is never passed in here. So we update an
    // active note in place (regenerate, same number) or insert a brand-new note
    // (first generation, or a replacement after a prior note was cancelled).
    let savedId: string | undefined;
    if (existing) {
      const { data: updated, error: dbErr } = await supabase.from('dsa_debit_notes')
        .update({
          payout_amount: gross,
          tds_amount: tds,
          net_payable_amount: net,
          generated_at: documentDate.toISOString(),
          pdf_url: path,
          // jsonb column: the snapshot is plain data but carries app types.
          pdf_snapshot: asJson(pdf_snapshot),
          created_by: employee.id,
        })
        .eq('id', existing.id)
        .select('id').single();
      if (dbErr) throw dbErr;
      savedId = updated?.id;
    } else {
      const { data: inserted, error: dbErr } = await supabase.from('dsa_debit_notes')
        .insert({
          dsa_id: g.dsa_id,
          month, year: selectedYear,
          payout_amount: gross,
          tds_amount: tds,
          net_payable_amount: net,
          debit_note_number: number,
          generated_at: documentDate.toISOString(),
          pdf_url: path,
          // jsonb column: the snapshot is plain data but carries app types.
          pdf_snapshot: asJson(pdf_snapshot),
          created_by: employee.id,
        })
        .select('id').single();
      if (dbErr) throw dbErr;
      savedId = inserted?.id;
    }

    // Record exactly which transactions this note covers. On regenerate the
    // covered set is unchanged (g was rebuilt from the note's own lines), so
    // clear and re-insert to keep payouts in sync. UNIQUE(transaction_id)
    // guarantees no payout can land in two active notes.
    if (savedId) {
      if (existing) {
        await supabase.from('dsa_debit_note_lines').delete().eq('debit_note_id', savedId);
      }
      const lineRows = g.rows.map(r => ({ debit_note_id: savedId!, transaction_id: r.txn_id, payout: r.payout }));
      if (lineRows.length) {
        const { error: lineErr } = await supabase.from('dsa_debit_note_lines').insert(lineRows);
        if (lineErr) throw lineErr;
      }
    }

    // Audit: record generation (best-effort; never block the generate flow)
    if (savedId) {
      await supabase.from('dsa_debit_note_events').insert({
        debit_note_id: savedId, event_type: 'generated', actor: 'employee',
        metadata: { debit_note_number: number, regenerated: !!existing },
      });
    }
  }

  const generateAllDebitNotes = async () => {
    if (groups.length === 0) return;
    setGenerating(true);
    setGenStatus('');
    try {
      // Each group holds only UNCOVERED payouts (rows already in an active note
      // were excluded upstream), so every group becomes a brand-new note — no
      // per-DSA "existing note" lookup, and nothing to skip. Notes already
      // generated/paid/signed keep their coverage untouched.
      let done = 0;
      for (const g of groups) {
        setGenStatus(`Generating ${++done}/${groups.length} — ${g.dsa_name}`);
        await generateForGroup(g, undefined);
      }
      await loadDebitNotes();
      await calculate(); // recompute pending so the just-covered payouts drop out
      setGenStatus(`Generated ${done} debit note${done === 1 ? '' : 's'} for ${MONTHS[selectedMonth]} ${selectedYear}`);
    } catch (e) {
      setGenStatus(`Error: ${e instanceof Error ? e.message : 'Failed to generate debit notes'}`);
    } finally {
      setGenerating(false);
    }
  };

  const regenerateOne = async (note: NWDSADebitNote) => {
    if (note.signature_status === 'signed') {
      setGenStatus('Signed debit notes are locked and cannot be regenerated.');
      return;
    }
    if (note.status !== 'generated') {
      setGenStatus(`Cannot regenerate a ${note.status} debit note.`);
      return;
    }
    setRegenDsaId(note.dsa_id);
    setGenStatus('');
    try {
      // Rebuild from THIS note's own covered transactions — they're excluded
      // from the pending groups precisely because this note covers them — and
      // recompute their current payout. Regenerate keeps the same transaction
      // set; only the amounts/PDF refresh.
      const { data: lines } = await supabase.from('dsa_debit_note_lines')
        .select('transaction_id').eq('debit_note_id', note.id);
      const txnIds = (lines || []).map((l: any) => l.transaction_id);
      if (!txnIds.length) {
        setGenStatus('This note has no linked transactions to regenerate from.');
        return;
      }
      const { data: txns } = await supabase.from('nw_transactions').select('*').in('id', txnIds);
      const { data: clients } = await supabase.from('nw_clients')
        .select('id, full_name, client_code, dsa_id, dsa:nw_dsa(id, dsa_code, full_name)')
        .in('id', (txns || []).map((t: any) => t.client_id));

      const rows: PayoutRow[] = [];
      for (const t of (txns as NWTransaction[]) || []) {
        const client = (clients as any[])?.find(c => c.id === t.client_id);
        if (!client || !client.dsa) continue;
        if (t.dsa_price == null || t.client_price == null) continue;
        const qty = t.quantity || 0;
        const payout = t.txn_type === 'sell'
          ? (t.dsa_price - t.client_price) * qty
          : (t.client_price - t.dsa_price) * qty;
        rows.push({
          txn_id: t.id,
          dsa_id: client.dsa.id, dsa_code: client.dsa.dsa_code, dsa_name: client.dsa.full_name,
          client_id: client.id, client_name: client.full_name, client_code: client.client_code,
          product_type: t.product_type, product_name: t.product_name, quantity: qty,
          dsa_price: t.dsa_price, client_price: t.client_price, payout,
        });
      }
      if (!rows.length) {
        setGenStatus('Linked transactions no longer carry DSA pricing.');
        return;
      }
      const g: DSAGroup = {
        dsa_id: note.dsa_id, dsa_code: rows[0].dsa_code, dsa_name: rows[0].dsa_name,
        rows, total: rows.reduce((s, r) => s + r.payout, 0),
      };
      await generateForGroup(g, note);
      await loadDebitNotes();
      setGenStatus(`Regenerated ${note.debit_note_number}`);
    } catch (e) {
      setGenStatus(`Error: ${e instanceof Error ? e.message : 'Failed to regenerate'}`);
    } finally {
      setRegenDsaId(null);
    }
  };

  // When a signed copy exists, Preview/Download act on it; otherwise on the
  // original generated PDF. The original is always preserved separately.
  const noteObjectPath = (note: NWDSADebitNote) => note.signed_pdf_url || note.pdf_url;
  const noteFileName = (note: NWDSADebitNote) =>
    note.signed_pdf_url ? `${note.debit_note_number}-signed.pdf` : `${note.debit_note_number}.pdf`;

  const downloadNote = async (note: NWDSADebitNote) => {
    setDownloadingId(note.id);
    try {
      const { data, error } = await supabase.storage
        .from(DEBIT_NOTE_BUCKET)
        .createSignedUrl(noteObjectPath(note), 120, { download: noteFileName(note) });
      if (error || !data) throw error || new Error('Could not create download link');
      window.open(data.signedUrl, '_blank');
    } catch (e) {
      setGenStatus(`Error: ${e instanceof Error ? e.message : 'Download failed'}`);
    } finally {
      setDownloadingId(null);
    }
  };

  const previewNote = async (note: NWDSADebitNote) => {
    setPreviewingId(note.id);
    try {
      // No `download` option → the PDF opens inline in a new browser tab
      const { data, error } = await supabase.storage
        .from(DEBIT_NOTE_BUCKET)
        .createSignedUrl(noteObjectPath(note), 120);
      if (error || !data) throw error || new Error('Could not create preview link');
      window.open(data.signedUrl, '_blank');
    } catch (e) {
      setGenStatus(`Error: ${e instanceof Error ? e.message : 'Preview failed'}`);
    } finally {
      setPreviewingId(null);
    }
  };

  // Send (or resend) the secure signing link to the DSA via the edge function.
  const sendForSignature = async (note: NWDSADebitNote) => {
    if (sendingId) return;
    if (note.signature_status === 'signed') { setGenStatus('This debit note is already signed.'); return; }
    setSendingId(note.id);
    setGenStatus('');
    try {
      const { data, error } = await supabase.functions.invoke('send-debit-note-email', {
        body: { debitNoteId: note.id },
      });
      if (error || !data?.success) throw new Error(await edgeFunctionErrorMessage(error, data, 'Failed to send link'));
      await loadDebitNotes();
      setGenStatus(note.signature_status === 'not_sent'
        ? `Signing link sent to ${note.dsa?.full_name || 'DSA'}`
        : `Signing link resent to ${note.dsa?.full_name || 'DSA'}`);
    } catch (e) {
      setGenStatus(`Error: ${e instanceof Error ? e.message : 'Failed to send signing link'}`);
    } finally {
      setSendingId(null);
    }
  };

  // Monthly ZIP: bundle one PDF per debit note (signed copy when available,
  // else the generated copy), preserving the debit note number as the filename.
  const downloadZip = async () => {
    if (zipping) return;
    const notes = debitNotes.filter(n => noteObjectPath(n));
    if (notes.length === 0) { setGenStatus('No debit notes to download for this period.'); return; }
    setZipping(true);
    setGenStatus('');
    try {
      const zip = new JSZip();
      let added = 0;
      for (const n of notes) {
        const { data, error } = await supabase.storage
          .from(DEBIT_NOTE_BUCKET)
          .createSignedUrl(noteObjectPath(n), 300);
        if (error || !data?.signedUrl) continue;
        const resp = await fetch(data.signedUrl);
        if (!resp.ok) continue;
        const buf = await resp.arrayBuffer();
        zip.file(`${n.debit_note_number}.pdf`, buf);
        added++;
      }
      if (added === 0) throw new Error('Could not retrieve any debit note PDFs');

      const blob = await zip.generateAsync({ type: 'blob' });
      const fileName = `Debit_Notes_${selectedYear}_${String(month).padStart(2, '0')}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);

      // Audit: per-document event trail + a single activity-log entry.
      await supabase.from('dsa_debit_note_events').insert(
        notes.map(n => ({ debit_note_id: n.id, event_type: 'zip_downloaded', actor: 'employee', metadata: { fileName } }))
      );
      await supabase.from('nw_activity_logs').insert([{
        employee_id: employee.id,
        action: 'Debit Notes ZIP Downloaded',
        description: `${fileName} — ${added} debit note${added === 1 ? '' : 's'} for ${MONTHS[selectedMonth]} ${selectedYear}`,
      }]);

      setGenStatus(`Downloaded ${fileName} (${added} debit note${added === 1 ? '' : 's'})`);
    } catch (e) {
      setGenStatus(`Error: ${e instanceof Error ? e.message : 'ZIP download failed'}`);
    } finally {
      setZipping(false);
    }
  };

  // Local calendar date (YYYY-MM-DD) — avoids locale/timezone ambiguity for
  // both the date-picker default/max and the stored payment date.
  const localDateStr = (d = new Date()) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const confirmMarkPaid = async () => {
    if (!payTarget) return;
    if (!payDate) { setPayError('Please select the payment date.'); return; }
    if (payDate > localDateStr()) { setPayError('Payment date cannot be in the future.'); return; }
    const ref = payRef.trim();
    if (!ref) { setPayError('Enter the transfer / payment reference number.'); return; }
    const note = payTarget;
    setStatusBusyId(note.id);
    setGenStatus('');
    try {
      // paid_at carries the BUSINESS payment date chosen by the admin.
      // The system audit timestamp is preserved by the marked_paid event's created_at.
      const paidAtIso = new Date(`${payDate}T00:00:00`).toISOString();
      const { error } = await supabase.from('dsa_debit_notes')
        .update({ status: 'paid', paid_at: paidAtIso, paid_by: employee.id, payment_reference: ref } as any)
        .eq('id', note.id);
      if (error) throw error;
      await supabase.from('dsa_debit_note_events').insert({
        debit_note_id: note.id, event_type: 'marked_paid', actor: 'employee',
        metadata: { net_payable: note.net_payable_amount ?? note.payout_amount, payment_date: payDate, payment_reference: ref },
      });
      setPayTarget(null);
      await loadDebitNotes();
      setGenStatus(`${note.debit_note_number} marked as Paid`);
    } catch (e) {
      setGenStatus(`Error: ${e instanceof Error ? e.message : 'Failed to mark as paid'}`);
    } finally {
      setStatusBusyId(null);
    }
  };

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    const reason = cancelReason.trim();
    if (!reason) { setCancelError('A cancellation reason is required.'); return; }
    const note = cancelTarget;
    if (note.signature_status === 'signed') { setCancelError('Signed debit notes are locked and cannot be cancelled.'); return; }
    setStatusBusyId(note.id);
    setCancelError('');
    setGenStatus('');
    try {
      const cancelledAt = new Date().toISOString();
      const { error } = await supabase.from('dsa_debit_notes')
        .update({ status: 'cancelled', cancelled_at: cancelledAt, cancelled_by: employee.id, cancel_reason: reason })
        .eq('id', note.id)
        .eq('status', 'generated'); // guard: never re-cancel / overwrite an existing cancellation
      if (error) throw error;
      // Release this note's covered transactions so they can be re-billed on a
      // fresh note. The cancelled note's pdf_snapshot keeps the audit record.
      await supabase.from('dsa_debit_note_lines').delete().eq('debit_note_id', note.id);
      // Audit trail
      await supabase.from('nw_activity_logs').insert([{
        employee_id: employee.id,
        action: 'Debit Note Cancelled',
        description: `${note.debit_note_number} (${note.dsa?.full_name || 'DSA'}) — ${fmt(note.net_payable_amount ?? note.payout_amount)} net payable cancelled. Reason: ${reason}`,
      }]);
      await supabase.from('dsa_debit_note_events').insert({
        debit_note_id: note.id, event_type: 'cancelled', actor: 'employee',
        metadata: { reason },
      });
      await loadDebitNotes();
      setGenStatus(`${note.debit_note_number} cancelled`);
      setCancelTarget(null);
      setCancelReason('');
    } catch (e) {
      setCancelError(e instanceof Error ? e.message : 'Failed to cancel');
    } finally {
      setStatusBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>DSA</p>
          <h1 className="text-2xl font-bold text-text-primary">DSA Payout</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Automated payout based on client price − DSA price × quantity</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {debitNotes.length > 0 && (
            <button onClick={downloadZip} disabled={zipping}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              {zipping ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileArchive className="w-4 h-4" />}
              {zipping ? 'Preparing ZIP...' : 'Download ZIP'}
            </button>
          )}
          {hasLoaded && groups.length > 0 && (
            <button onClick={generateAllDebitNotes} disabled={generating}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: 'rgba(var(--accent-rgb),0.1)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.4)' }}>
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              {generating ? 'Generating...' : 'Generate Debit Note'}
            </button>
          )}
          <button onClick={calculate} disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-on-accent disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
            <Wallet className="w-4 h-4" />
            {loading ? 'Calculating...' : 'Calculate Payout'}
          </button>
        </div>
      </div>

      {/* Period selector */}
      <div className="rounded-2xl p-5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Select Period</p>
        <div className="flex items-center gap-3 flex-wrap">
          {isAdmin && (
            <div className="relative">
              <select value={empFilter} onChange={e => setEmpFilter(e.target.value)}
                className="pl-3 pr-8 py-2.5 rounded-xl text-sm text-text-primary outline-none appearance-none"
                style={{ background: 'var(--bg-base)', border: '1px solid rgba(var(--accent-rgb),0.4)' }}>
                <option value="all">All Employees</option>
                {empList.map(e => <option key={e.id} value={e.id}>{e.full_name} ({e.employee_code})</option>)}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--accent)' }} />
            </div>
          )}
          <div className="relative">
            <select value={selectedMonth} onChange={e => setSelectedMonth(parseInt(e.target.value))}
              className="pl-3 pr-8 py-2.5 rounded-xl text-sm text-text-primary outline-none appearance-none"
              style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
              {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-faint)' }} />
          </div>
          <div className="relative">
            <select value={selectedYear} onChange={e => setSelectedYear(parseInt(e.target.value))}
              className="pl-3 pr-8 py-2.5 rounded-xl text-sm text-text-primary outline-none appearance-none"
              style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-faint)' }} />
          </div>
          <div className="px-3 py-2.5 rounded-xl text-sm" style={{ background: 'rgba(var(--accent-rgb),0.08)', border: '1px solid rgba(var(--accent-rgb),0.2)', color: 'var(--accent)' }}>
            {startDate} &rarr; {endDate}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      {hasLoaded && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[
            { label: 'Gross Payout', value: fmt(periodGross), color: 'var(--text-secondary)' },
            { label: 'TDS @ 2%', value: `- ${fmt(periodTds)}`, color: 'rgb(var(--danger-soft-rgb))' },
            { label: 'Net Payable', value: fmt(periodNet), color: 'var(--success)' },
            { label: 'DSAs Involved', value: String(periodDsas), color: 'var(--accent)' },
            { label: 'Total Entries', value: String(periodEntries), color: 'var(--text-secondary)' },
          ].map(s => (
            <div key={s.label} className="rounded-2xl p-5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-faint)' }}>{s.label}</p>
              <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Pending indicator — the portion of the period not yet turned into a
          debit note (the top cards now show the whole-period total). */}
      {hasLoaded && totalPayout > 0 && (
        <div className="rounded-xl px-4 py-2.5 text-sm flex items-center gap-2.5"
          style={{ background: 'rgba(var(--accent-rgb),0.06)', border: '1px solid rgba(var(--accent-rgb),0.2)', color: 'var(--text-secondary)' }}>
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />
          <span>
            <strong style={{ color: 'var(--text-primary)' }}>{fmt(totalPayout)}</strong> across {pendingEntries} payout{pendingEntries === 1 ? '' : 's'} still pending — not yet in a debit note. Generate below.
          </span>
        </div>
      )}

      {/* Debit Note status banner */}
      {(generating || genStatus) && (
        <div className="rounded-xl px-4 py-3 flex items-center gap-3 text-sm"
          style={{
            background: genStatus.startsWith('Error') ? 'rgba(239,68,68,0.08)' : 'rgba(var(--accent-rgb),0.08)',
            border: `1px solid ${genStatus.startsWith('Error') ? 'rgba(239,68,68,0.3)' : 'rgba(var(--accent-rgb),0.25)'}`,
            color: genStatus.startsWith('Error') ? 'rgb(var(--danger-soft-rgb))' : 'var(--accent)',
          }}>
          {generating && <Loader2 className="w-4 h-4 animate-spin" />}
          <span>{generating ? genStatus || 'Generating debit notes...' : genStatus}</span>
        </div>
      )}

      {/* Previous Debit Notes for the selected month */}
      {debitNotes.length > 0 && (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ background: 'rgba(var(--accent-rgb),0.04)', borderBottom: '1px solid var(--border)' }}>
            <div>
              <div className="flex items-center gap-2">
                <FileCheck2 className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                <p className="text-sm font-bold text-text-primary">Debit Notes — {MONTHS[selectedMonth]} {selectedYear}</p>
              </div>
              <p className="text-[11px] mt-0.5 pl-6" style={{ color: 'var(--text-faint)' }}>Grouped by payment date — paid notes appear in the month they were paid; unpaid notes stay in their deal month until paid.</p>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{debitNotes.length} shown</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {['Debit Note No.', 'DSA', 'Net Payable', 'Status', 'Timeline', 'Actions'].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {debitNotes.map(note => {
                  const stage = deriveStage(note);
                  const busy = statusBusyId === note.id;
                  const signed = note.signature_status === 'signed';
                  const locked = signed || note.status === 'cancelled';
                  // payout_amount is the gross; fall back to deriving TDS/net for
                  // any pre-TDS legacy rows that have not been backfilled yet.
                  const gross = note.payout_amount;
                  const tds = note.tds_amount ?? computePayoutTds(gross).tds;
                  const net = note.net_payable_amount ?? (gross - tds);
                  // Completed-step timestamps for the Generated→…→Paid timeline.
                  const steps: { label: string; at: string | null; color: string }[] = [
                    { label: 'Sent', at: fmtDateTime(note.sent_at), color: 'rgb(var(--c-violet-rgb))' },
                    { label: 'Viewed', at: fmtDateTime(note.viewed_at), color: 'rgb(var(--info-soft-rgb))' },
                    { label: 'Signed', at: fmtDateTime(note.signed_at), color: 'rgb(var(--success-soft-rgb))' },
                    { label: 'Paid', at: note.paid_at ? new Date(note.paid_at).toLocaleDateString('en-GB') : null, color: 'var(--success)' },
                  ].filter(s => s.at);
                  return (
                  <tr key={note.id} style={{ borderBottom: '1px solid var(--bg-raised)' }}>
                    <td className="px-5 py-3 text-sm font-mono" style={{ color: 'var(--accent)' }}>
                      {note.debit_note_number}
                      {signed && <Lock className="w-3 h-3 inline-block ml-1.5 -mt-0.5" style={{ color: 'rgb(var(--success-soft-rgb))' }} />}
                    </td>
                    <td className="px-5 py-3">
                      <p className="text-sm font-medium text-text-primary">{note.dsa?.full_name || '—'}</p>
                      <p className="text-xs font-mono" style={{ color: 'var(--text-faint)' }}>{note.dsa?.dsa_code || ''}</p>
                    </td>
                    <td className="px-5 py-3">
                      <p className="text-sm font-bold text-c-emerald">{fmt(net)}</p>
                      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Gross {fmt(gross)} · TDS {fmt(tds)}</p>
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-block px-2.5 py-1 rounded-full text-xs font-semibold"
                        style={{ background: stage.bg, color: stage.color, border: `1px solid ${stage.border}` }}>
                        {stage.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {note.status === 'cancelled' ? (
                        <div className="max-w-[240px]">
                          <p style={{ color: 'rgb(var(--danger-soft-rgb))' }}>Cancelled {note.cancelled_at ? new Date(note.cancelled_at).toLocaleDateString('en-IN') : ''}</p>
                          <p style={{ color: 'var(--text-faint)' }}>by {note.cancelled_by_employee?.full_name || '—'}</p>
                          {note.cancel_reason && (
                            <p className="mt-1" style={{ color: 'var(--text-secondary)' }}>
                              <span style={{ color: 'var(--text-muted)' }}>Reason: </span>{note.cancel_reason}
                            </p>
                          )}
                        </div>
                      ) : steps.length ? (
                        <div className="space-y-0.5">
                          {steps.map(s => (
                            <p key={s.label}><span style={{ color: s.color }}>{s.label} On:</span> {s.at}</p>
                          ))}
                          {(note as any).payment_reference && (
                            <p><span style={{ color: 'var(--text-muted)' }}>Ref:</span> <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>{(note as any).payment_reference}</span></p>
                          )}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-faint)' }}>—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => previewNote(note)} disabled={previewingId === note.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                          style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                          {previewingId === note.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                          {signed ? 'Preview Signed' : 'Preview'}
                        </button>
                        <button onClick={() => downloadNote(note)} disabled={downloadingId === note.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                          style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                          {downloadingId === note.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                          {signed ? 'Download Signed' : 'Download'}
                        </button>
                        {/* Send / Resend for signature — until signed, while active */}
                        {!locked && (
                          <button onClick={() => sendForSignature(note)} disabled={sendingId === note.id}
                            title={note.signature_status === 'not_sent' ? 'Email the DSA a secure signing link' : 'Resend the secure signing link'}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                            style={{ background: 'rgba(168,139,250,0.1)', color: 'rgb(var(--c-violet-rgb))', border: '1px solid rgba(168,139,250,0.3)' }}>
                            {sendingId === note.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                            {note.signature_status === 'not_sent' ? 'Send for Signature' : 'Resend Link'}
                          </button>
                        )}
                        {/* Regenerate / Cancel — disabled once signed or cancelled */}
                        {note.status === 'generated' && !signed && (
                          <>
                            {/* Gated on the note's OWN line count, not on the
                                pending payout groups. regenerateOne rebuilds
                                from dsa_debit_note_lines, and a note's covered
                                transactions are excluded from `groups` by
                                definition — so gating on `groups` disabled the
                                button for every note that had actually been
                                generated, which is all of them. A note with no
                                lines genuinely cannot be regenerated; that is
                                the only real precondition. */}
                            <button onClick={() => regenerateOne(note)}
                              disabled={regenDsaId === note.dsa_id || !noteLineCount(note)}
                              title={noteLineCount(note)
                                ? 'Regenerate PDF from this note’s covered transactions'
                                : 'This note has no linked transactions to regenerate from'}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
                              style={{ background: 'rgba(var(--accent-rgb),0.08)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.25)' }}>
                              {regenDsaId === note.dsa_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                              Regenerate
                            </button>
                            {isAdmin && (
                              <button onClick={() => { setCancelTarget(note); setCancelReason(''); setCancelError(''); }} disabled={busy}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                                style={{ background: 'rgba(239,68,68,0.08)', color: 'rgb(var(--danger-soft-rgb))', border: '1px solid rgba(239,68,68,0.3)' }}>
                                <XCircle className="w-3.5 h-3.5" />
                                Cancel
                              </button>
                            )}
                          </>
                        )}
                        {/* Mark as Paid — admin; available for generated notes (incl. after signing) */}
                        {isAdmin && note.status === 'generated' && (
                          <button onClick={() => { setPayTarget(note); setPayDate(localDateStr()); setPayRef(''); setPayError(''); }} disabled={busy}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                            style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--success)', border: '1px solid rgba(16,185,129,0.3)' }}>
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                            Mark as Paid
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* DSA Groups */}
      {hasLoaded && (
        <div className="space-y-4">
          {groups.length === 0 ? (
            <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <Wallet className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--border-strong)' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--text-faint)' }}>No DSA payout entries for {MONTHS[selectedMonth]} {selectedYear}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--border-strong)' }}>DSA payouts are generated from holdings added in the selected period with DSA pricing</p>
            </div>
          ) : groups.map(g => {
            const gTds = computePayoutTds(g.total).tds;
            const gNet = g.total - gTds;
            return (
            <div key={g.dsa_id} className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <div className="px-5 py-4 flex items-center justify-between" style={{ background: 'rgba(var(--accent-rgb),0.04)', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <p className="text-sm font-bold text-text-primary">{g.dsa_name}</p>
                  <p className="text-xs font-mono" style={{ color: 'var(--text-faint)' }}>{g.dsa_code}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Net Payable (after 2% TDS)</p>
              
                  <p className="text-lg font-bold text-c-emerald">{fmt(gNet)}</p>
                  <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Gross {fmt(g.total)} · TDS {fmt(gTds)}</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full nw-table">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      {['Client', 'Product', 'Qty', 'DSA Price', 'Client Price', 'Payout'].map(h => (
                        <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--bg-raised)' }}>
                        <td className="px-5 py-3">
                          <p className="text-sm font-medium text-text-primary">{r.client_name}</p>
                          <p className="text-xs font-mono" style={{ color: 'var(--text-faint)' }}>{r.client_code}</p>
                        </td>
                        <td className="px-5 py-3">
                          <p className="text-sm text-text-primary">{r.product_name}</p>
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{PRODUCT_LABELS[r.product_type as keyof typeof PRODUCT_LABELS] || r.product_type}</p>
                        </td>
                        <td className="px-5 py-3 text-sm text-text-primary">{r.quantity.toLocaleString('en-IN')}</td>
                        <td className="px-5 py-3 text-sm text-text-primary">{fmt(r.dsa_price)}</td>
                        <td className="px-5 py-3 text-sm text-text-primary">{fmt(r.client_price)}</td>
                        <td className="px-5 py-3">
                          <p className={`text-sm font-bold ${r.payout >= 0 ? 'text-c-emerald' : 'text-c-red'}`}>
                            {r.payout >= 0 ? '' : '-'}{fmt(Math.abs(r.payout))}
                          </p>
                          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                            Spread: {fmt(r.client_price - r.dsa_price)} × {r.quantity}
                          </p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '1px solid var(--border)' }}>
                      <td colSpan={5} className="px-5 py-2.5 text-xs font-bold" style={{ color: 'var(--text-faint)' }}>Gross Payout — {g.dsa_name}</td>
                      <td className="px-5 py-2.5 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>{fmt(g.total)}</td>
                    </tr>
                    <tr>
                      <td colSpan={5} className="px-5 py-2.5 text-xs font-bold" style={{ color: 'var(--text-faint)' }}>TDS @ 2%</td>
                      <td className="px-5 py-2.5 text-sm font-semibold" style={{ color: 'rgb(var(--danger-soft-rgb))' }}>- {fmt(gTds)}</td>
                    </tr>
                    <tr style={{ borderTop: '1px solid var(--border)' }}>
                      <td colSpan={5} className="px-5 py-3 text-xs font-bold" style={{ color: 'var(--accent)' }}>Net Payable — {g.dsa_name}</td>
                      <td className="px-5 py-3 text-sm font-bold text-c-emerald">{fmt(gNet)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
            );
          })}

          {groups.length > 1 && (
            <div className="rounded-2xl p-4 flex items-center justify-between" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)' }}>
              <div>
                <p className="text-sm font-bold text-text-primary">Net Payable — All DSAs</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Gross {fmt(totalPayout)} · TDS @ 2% {fmt(totalTds)}</p>
              </div>
              <p className="text-xl font-bold text-c-emerald">{fmt(totalNet)}</p>
            </div>
          )}
        </div>
      )}

      {!hasLoaded && (
        <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <Wallet className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--border-strong)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--text-faint)' }}>Select a period and click Calculate Payout</p>
          <p className="text-xs mt-1" style={{ color: 'var(--border-strong)' }}>Payout = (Client Price − DSA Price) × Quantity for each DSA holding</p>
        </div>
      )}

      {/* Cancel Debit Note — confirmation modal (reason required) */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => { if (statusBusyId !== cancelTarget.id) setCancelTarget(null); }}>
          <div className="w-full max-w-md rounded-2xl overflow-hidden"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
            onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
              <XCircle className="w-5 h-5" style={{ color: 'rgb(var(--danger-soft-rgb))' }} />
              <p className="text-sm font-bold text-text-primary">Cancel Debit Note</p>
            </div>
            <div className="p-5 space-y-4">
              <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <p style={{ color: 'rgb(var(--danger-soft-rgb))' }} className="font-mono font-semibold">{cancelTarget.debit_note_number}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  {cancelTarget.dsa?.full_name || 'DSA'} · {fmt(cancelTarget.net_payable_amount ?? cancelTarget.payout_amount)} net payable
                </p>
              </div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Cancellation is permanent and recorded in the audit log. The reason cannot be edited afterwards.
              </p>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Cancellation Reason <span style={{ color: 'rgb(var(--danger-soft-rgb))' }}>*</span>
                </label>
                <textarea
                  value={cancelReason}
                  onChange={e => { setCancelReason(e.target.value); if (cancelError) setCancelError(''); }}
                  rows={3}
                  placeholder="Enter the reason for cancelling this debit note"
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm text-text-primary outline-none resize-none"
                  style={{ background: 'var(--bg-base)', border: `1px solid ${cancelError ? 'rgb(var(--danger-soft-rgb))' : 'var(--border)'}` }}
                />
                {cancelError && <p className="text-xs mt-1.5" style={{ color: 'rgb(var(--danger-soft-rgb))' }}>{cancelError}</p>}
              </div>
            </div>
            <div className="px-5 py-4 flex items-center justify-end gap-2" style={{ borderTop: '1px solid var(--border)' }}>
              <button onClick={() => setCancelTarget(null)} disabled={statusBusyId === cancelTarget.id}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                Keep Debit Note
              </button>
              <button onClick={confirmCancel} disabled={statusBusyId === cancelTarget.id || !cancelReason.trim()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
                style={{ background: 'rgba(239,68,68,0.12)', color: 'rgb(var(--danger-soft-rgb))', border: '1px solid rgba(239,68,68,0.4)' }}>
                {statusBusyId === cancelTarget.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mark as Paid — choose the actual business payment date */}
      {payTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => { if (statusBusyId !== payTarget.id) setPayTarget(null); }}>
          <div className="w-full max-w-md rounded-2xl overflow-hidden"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
            onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
              <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--success)' }} />
              <p className="text-sm font-bold text-text-primary">Mark as Paid</p>
            </div>
            <div className="p-5 space-y-4">
              <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)' }}>
                <p style={{ color: 'var(--success)' }} className="font-mono font-semibold">{payTarget.debit_note_number}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  {payTarget.dsa?.full_name || 'DSA'} · {fmt(payTarget.net_payable_amount ?? payTarget.payout_amount)} net payable
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Payment Date <span style={{ color: 'var(--success)' }}>*</span>
                </label>
                <input
                  type="date"
                  value={payDate}
                  max={localDateStr()}
                  onChange={e => { setPayDate(e.target.value); if (payError) setPayError(''); }}
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm text-text-primary outline-none"
                  style={{ background: 'var(--bg-base)', border: `1px solid ${payError ? 'rgb(var(--danger-soft-rgb))' : 'var(--border)'}` }}
                />
                <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
                  Select the actual date the DSA was paid. The system audit time is recorded separately.
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Transfer / Payment Reference <span style={{ color: 'var(--success)' }}>*</span>
                </label>
                <input
                  type="text"
                  value={payRef}
                  onChange={e => { setPayRef(e.target.value); if (payError) setPayError(''); }}
                  placeholder="e.g. bank UTR / NEFT / IMPS reference"
                  className="w-full px-3.5 py-2.5 rounded-xl text-sm text-text-primary outline-none font-mono"
                  style={{ background: 'var(--bg-base)', border: `1px solid ${payError ? 'rgb(var(--danger-soft-rgb))' : 'var(--border)'}` }}
                />
                <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
                  The bank transaction reference for this payout — kept on record with the note.
                </p>
              </div>
              {payError && <p className="text-xs" style={{ color: 'rgb(var(--danger-soft-rgb))' }}>{payError}</p>}
            </div>
            <div className="px-5 py-4 flex items-center justify-end gap-2" style={{ borderTop: '1px solid var(--border)' }}>
              <button onClick={() => setPayTarget(null)} disabled={statusBusyId === payTarget.id}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <button onClick={confirmMarkPaid} disabled={statusBusyId === payTarget.id || !payDate || !payRef.trim()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
                style={{ background: 'rgba(16,185,129,0.12)', color: 'var(--success)', border: '1px solid rgba(16,185,129,0.4)' }}>
                {statusBusyId === payTarget.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Confirm Payment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
