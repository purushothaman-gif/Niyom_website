/**
 * MF Account Queue — which mutual fund clients still need their account opened
 * on the fund platform.
 *
 * Staff open an account by keying the client's details into the platform's own
 * CRM. This page is the worklist for that: clients whose record is complete
 * and waiting ("Ready to open"), clients who cannot be opened yet and what is
 * missing ("Needs details"), and those already done. A client leaves the
 * ready list when an employee ticks them off here, or by themselves the first
 * time their sign-on to the platform succeeds.
 *
 * Readiness comes from the same account sheet staff copy from
 * (mfAccountSheet.ts), so "ready" here and the sheet can never disagree.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileText, ListChecks, Loader2, RotateCcw, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { NWClient, NWEmployee } from './types';
import {
  buildMfAccountSheet, queueBucket, type MfAccountSheet, type QueueBucket, type SheetClient, type SheetNominee,
} from '../../supabase/functions/_shared/profile/mfAccountSheet';
import { ClientProfileExtrasModal } from './ClientProfileExtras';

interface Row {
  client: NWClient;
  sheet: MfAccountSheet;
  bucket: QueueBucket;
}

const TABS: { key: QueueBucket; label: string; empty: string }[] = [
  { key: 'ready', label: 'Ready to open', empty: 'No clients are waiting to be opened.' },
  { key: 'needs_details', label: 'Needs details', empty: 'Every mutual fund client has complete details.' },
  { key: 'opened', label: 'Opened', empty: 'No accounts have been opened yet.' },
];

const day = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export default function MfAccountQueue({ employee }: { employee: NWEmployee }) {
  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<QueueBucket>('ready');
  const [term, setTerm] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [panel, setPanel] = useState<NWClient | null>(null);

  const load = useCallback(async () => {
    setError('');
    // Row policies already limit an employee to their own clients; admins see all.
    const { data, error: cErr } = await supabase
      .from('nw_clients')
      .select('*, employee:nw_employees(full_name, employee_code)')
      .contains('investment_preferences', ['mutual_funds'])
      .order('created_at', { ascending: false })
      .limit(2000);
    if (cErr) { setError('Could not load clients. Please try again.'); setRows([]); return; }
    const clients = (data as unknown as NWClient[]) ?? [];
    const byClient = new Map<string, SheetNominee[]>();
    const ids = clients.map((c) => c.id);
    for (let i = 0; i < ids.length; i += 200) {
      const { data: noms } = await supabase
        .from('nw_client_nominees')
        .select('client_id, full_name, relationship, dob, share_percent, id_type, id_number, guardian_name, guardian_dob, guardian_pan, guardian_relationship')
        .in('client_id', ids.slice(i, i + 200))
        .order('created_at');
      for (const n of (noms as (SheetNominee & { client_id: string })[] | null) ?? []) {
        byClient.set(n.client_id, [...(byClient.get(n.client_id) ?? []), n]);
      }
    }
    setRows(clients.map((client) => {
      const sheet = buildMfAccountSheet(client as unknown as SheetClient, byClient.get(client.id) ?? []);
      return { client, sheet, bucket: queueBucket(client.mf_platform_opened_at, sheet) };
    }));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<QueueBucket, number> = { ready: 0, needs_details: 0, opened: 0 };
    for (const r of rows ?? []) c[r.bucket]++;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const q = term.trim().toLowerCase();
    return (rows ?? []).filter((r) => r.bucket === tab && (!q
      || r.client.full_name.toLowerCase().includes(q)
      || (r.client.client_code || '').toLowerCase().includes(q)
      || (r.client.pan || '').toLowerCase().includes(q)));
  }, [rows, tab, term]);

  const setOpened = async (clientId: string, opened: boolean) => {
    setBusyId(clientId);
    setError('');
    const { error: uErr } = await supabase.from('nw_clients').update(
      opened
        ? { mf_platform_opened_at: new Date().toISOString(), mf_platform_opened_by: employee.id, mf_platform_opened_via: 'staff' }
        : { mf_platform_opened_at: null, mf_platform_opened_by: null, mf_platform_opened_via: null },
    ).eq('id', clientId);
    setBusyId(null);
    setConfirming(null);
    if (uErr) return setError('Could not update the client. Please try again.');
    await supabase.from('nw_activity_logs').insert([{
      employee_id: employee.id,
      client_id: clientId,
      action: opened ? 'MF Account Opened on Platform' : 'MF Account Mark Removed',
      description: opened
        ? 'Marked as opened on the mutual fund platform from the MF account queue.'
        : 'The "opened on the mutual fund platform" mark was removed from the MF account queue.',
    }]).then(() => {}, () => {});
    await load();
  };

  const cell = { borderColor: 'var(--border)', color: 'var(--text-primary)' } as const;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
          <ListChecks className="h-5 w-5" style={{ color: 'var(--accent)' }} /> MF Account Queue
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          Clients who chose mutual funds, and whether their account has been opened on the fund platform. Open the account
          sheet, key it into the platform, then mark the client as opened.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => { setTab(t.key); setConfirming(null); }}
            className="rounded-lg border px-3.5 py-2 text-sm font-semibold transition-colors"
            style={tab === t.key
              ? { background: 'rgba(var(--accent-rgb),0.12)', borderColor: 'var(--accent)', color: 'var(--accent)' }
              : { background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
            {t.label} <span className="ml-1 opacity-75">{rows ? counts[t.key] : '…'}</span>
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Name, code or PAN"
            className="rounded-lg border py-2 pl-9 pr-3 text-sm outline-none"
            style={{ background: 'var(--bg-base)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
        </div>
      </div>

      {error && <p className="rounded-lg border px-3.5 py-2.5 text-sm" style={{ borderColor: 'rgba(239,68,68,0.3)', color: 'var(--danger)' }}>{error}</p>}

      <div className="overflow-x-auto rounded-2xl border" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}>
        {rows === null ? (
          <div className="flex items-center gap-2 p-6 text-sm" style={{ color: 'var(--text-muted)' }}><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : visible.length === 0 ? (
          <p className="p-6 text-sm" style={{ color: 'var(--text-faint)' }}>{term ? 'No clients match that search.' : TABS.find((t) => t.key === tab)!.empty}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase" style={{ color: 'var(--text-faint)' }}>
                <th className="px-4 py-3">Client</th>
                {isAdmin && <th className="px-4 py-3">Employee</th>}
                <th className="px-4 py-3">{tab === 'needs_details' ? 'Still needed' : tab === 'opened' ? 'Opened' : 'Auto-debit'}</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ client: c, sheet }) => (
                <tr key={c.id} className="border-t align-top" style={cell}>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{c.full_name}</p>
                    <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{c.client_code}{c.onboarding_status !== 'active' ? ' · KYC not approved yet' : ''}</p>
                  </td>
                  {isAdmin && <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{c.employee?.full_name ?? '—'}</td>}
                  <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>
                    {tab === 'needs_details' ? (
                      <>
                        <ul className="list-disc space-y-0.5 pl-4">
                          {sheet.missing.slice(0, 4).map((m) => <li key={m}>{m}</li>)}
                        </ul>
                        {sheet.missing.length > 4 && <p className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>and {sheet.missing.length - 4} more</p>}
                      </>
                    ) : tab === 'opened' ? (
                      <>
                        {c.mf_platform_opened_at ? day(c.mf_platform_opened_at) : '—'}
                        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                          {c.mf_platform_opened_via === 'sign_on' ? 'Confirmed by the client’s sign-on' : 'Marked by staff'}
                        </p>
                      </>
                    ) : (
                      c.mandate_preference === 'enach' ? 'e-NACH' : c.mandate_preference === 'upi' ? 'UPI Autopay' : c.mandate_preference === 'later' ? 'Set up later' : 'Not asked'
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button type="button" onClick={() => setPanel(c)}
                        className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                        <FileText className="h-3.5 w-3.5" /> {tab === 'needs_details' ? 'Complete details' : 'Account sheet'}
                      </button>
                      {tab === 'ready' && (confirming === c.id ? (
                        <>
                          <button type="button" disabled={busyId === c.id} onClick={() => void setOpened(c.id, true)}
                            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold disabled:opacity-50"
                            style={{ background: 'var(--success)', color: '#fff' }}>
                            {busyId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Yes, it is opened
                          </button>
                          <button type="button" onClick={() => setConfirming(null)} className="text-xs font-semibold" style={{ color: 'var(--text-faint)' }}>Cancel</button>
                        </>
                      ) : (
                        <button type="button" onClick={() => setConfirming(c.id)}
                          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold"
                          style={{ borderColor: 'var(--success)', color: 'var(--success)' }}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Mark opened
                        </button>
                      ))}
                      {tab === 'opened' && c.mf_platform_opened_via === 'staff' && (
                        <button type="button" disabled={busyId === c.id} onClick={() => void setOpened(c.id, false)}
                          className="flex items-center gap-1.5 text-xs font-semibold disabled:opacity-50" style={{ color: 'var(--text-faint)' }}
                          title="Remove the mark if it was set by mistake">
                          <RotateCcw className="h-3.5 w-3.5" /> Undo
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {panel && (
        <ClientProfileExtrasModal clientId={panel.id} clientName={panel.full_name} employeeId={employee.id}
          onClose={() => { setPanel(null); void load(); }} />
      )}
    </div>
  );
}
