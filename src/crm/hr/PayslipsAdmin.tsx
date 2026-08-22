/**
 * Payslip administration.
 *
 * Publishing is what makes a payslip visible to the employee at all: the RLS on
 * hr_payslips (and on the payroll records and lines behind it) only lets
 * someone read their own row once `published` is true. Reopening a run flips it
 * back to false, so figures that are about to change stop being downloadable.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileText, Send } from 'lucide-react';
import * as api from './hrApi';
import { hrError } from './hrError';
import {
  ConfirmDialog, EmptyState, GhostButton, Notice, Pill, SectionCard, Select,
  Skeleton, StatTile, TableWrap,
} from './hrUi';
import { useToast } from './useToast';
import type { HRAccess, PayrollRecord, PayrollRun, Payslip } from './hrTypes';
import { inr } from '../../lib/money';
import { downloadPayslip } from './payslipDocument';

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleDateString('en-IN', { month: 'long' }));

export default function PayslipsAdmin({ access }: { access: HRAccess }) {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [runId, setRunId] = useState('');
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [records, setRecords] = useState<PayrollRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { show, node } = useToast();

  useEffect(() => {
    api.listRuns()
      .then(r => {
        const finalised = r.filter(x => ['locked', 'paid'].includes(x.status));
        setRuns(finalised);
        if (finalised[0]) setRunId(finalised[0].id);
      })
      .catch(err => show(hrError(err), false))
      .finally(() => setLoading(false));
  }, [show]);

  const load = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    try {
      const [p, r] = await Promise.all([api.listPayslips({ runId }), api.listRunRecords(runId)]);
      setPayslips(p); setRecords(r);
    } catch (err) {
      show(hrError(err), false);
    } finally {
      setLoading(false);
    }
  }, [runId, show]);

  useEffect(() => { load(); }, [load]);

  const run = runs.find(r => r.id === runId);
  const included = useMemo(() => records.filter(r => r.status === 'included'), [records]);
  const published = payslips.filter(p => p.published).length;

  const publish = async () => {
    setPublishing(true);
    try {
      const res = await api.publishPayslips(runId) as { published: number };
      show(`${res.published} payslip(s) published — employees have been notified.`);
      setConfirmPublish(false);
      load();
    } catch (err) {
      show(hrError(err), false);
    } finally {
      setPublishing(false);
    }
  };

  const download = async (p: Payslip) => {
    setBusyId(p.id);
    try { await downloadPayslip(p.id); }
    catch (err) { show(hrError(err, 'Could not generate that payslip.'), false); }
    finally { setBusyId(null); }
  };

  const downloadAll = async () => {
    // Sequential on purpose: each payslip renders through an offscreen DOM node
    // and a canvas capture. Firing a dozen at once fights for the main thread
    // and, on a slower machine, produces blank pages.
    setBusyId('all');
    let done = 0;
    try {
      for (const p of payslips.filter(x => x.published)) {
        await downloadPayslip(p.id);
        done++;
      }
      show(`${done} payslip(s) downloaded.`);
    } catch (err) {
      show(`${hrError(err)} ${done} payslip(s) were downloaded before the error.`, false);
    } finally {
      setBusyId(null);
    }
  };

  if (runs.length === 0 && !loading) {
    return (
      <EmptyState icon={FileText} title="No finalised payroll yet"
        message="Payslips become available once a payroll run has been approved and locked." />
    );
  }

  return (
    <div className="space-y-5">
      <SectionCard
        title="Payslips"
        subtitle="An employee can only see their payslip once it is published."
        actions={
          <>
            <Select value={runId} onChange={e => setRunId(e.target.value)} style={{ width: 200 }}>
              {runs.map(r => (
                <option key={r.id} value={r.id}>{MONTHS[r.period_month - 1]} {r.period_year}</option>
              ))}
            </Select>
            {payslips.some(p => p.published) && (
              <GhostButton onClick={downloadAll} disabled={busyId === 'all'}>
                <Download className="w-3.5 h-3.5 inline mr-1" />
                {busyId === 'all' ? 'Downloading…' : 'Download All'}
              </GhostButton>
            )}
            {access.canEdit.payslips && published < included.length && (
              <GhostButton onClick={() => setConfirmPublish(true)}>
                <Send className="w-3.5 h-3.5 inline mr-1" />Publish Payslips
              </GhostButton>
            )}
          </>
        }
        padded={false}
      >
        <div className="px-5 pt-4 grid grid-cols-3 gap-3">
          <StatTile label="In this run" value={included.length} />
          <StatTile label="Published" value={published} tone={published === included.length ? 'good' : 'warn'} />
          <StatTile label="Net paid" value={inr(Number(run?.total_net ?? 0))} tone="good" />
        </div>

        <div className="p-5">
          {loading ? <Skeleton /> : payslips.length === 0 ? (
            <EmptyState icon={FileText} title="Not published yet"
              message="Publishing generates a numbered payslip for every included employee and notifies them." />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className="text-left">Employee</th><th className="text-left">Payslip Number</th>
                  <th className="text-right">Net Pay</th><th className="text-left">Status</th>
                  <th className="text-right">Downloads</th><th className="text-right"></th>
                </tr>
              </thead>
              <tbody>
                {payslips.map(p => {
                  const rec = records.find(r => r.id === p.record_id);
                  return (
                    <tr key={p.id}>
                      <td>
                        <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{rec?.full_name ?? '—'}</p>
                        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{rec?.employee_code}</p>
                      </td>
                      <td className="font-mono text-xs">{p.payslip_number}</td>
                      <td className="text-right tabular-nums font-semibold">{inr(Number(p.net_pay))}</td>
                      <td><Pill value={p.published ? 'published' : 'withdrawn'} small /></td>
                      <td className="text-right tabular-nums">{p.download_count}</td>
                      <td className="text-right">
                        <button onClick={() => download(p)} disabled={busyId === p.id}
                          className="text-xs font-semibold disabled:opacity-60" style={{ color: 'var(--accent-soft)' }}>
                          {busyId === p.id ? 'Preparing…' : 'Download'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </div>
      </SectionCard>

      {published > 0 && published < included.length && (
        <Notice tone="warn">
          {included.length - published} employee(s) in this run have no published payslip. Publish again to cover them.
        </Notice>
      )}

      <ConfirmDialog
        open={confirmPublish}
        tone="accent"
        title="Publish payslips?"
        message={`Every included employee in ${run ? `${MONTHS[run.period_month - 1]} ${run.period_year}` : 'this run'} will be notified and will be able to download their payslip.`}
        confirmLabel="Publish"
        busy={publishing}
        onCancel={() => setConfirmPublish(false)}
        onConfirm={publish}
      />

      {node}
    </div>
  );
}
