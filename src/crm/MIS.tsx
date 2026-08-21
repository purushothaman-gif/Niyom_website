import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { NWEmployee, NWClient } from './types';
import { fmt, fmtDate, PRODUCT_LABELS } from './utils';
import { BarChart3, Download, ChevronDown, Image as ImageIcon } from 'lucide-react';
import { MISRow, computeMisRows, monthRange } from './misRevenue';
import { generateTeamRevenueImage, isExcludedFromTeamCard } from './misTeamImage';

interface Props { employee: NWEmployee; }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export default function MIS({ employee }: Props) {
  const today = new Date();
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth()); // 0-indexed
  const [rows, setRows] = useState<MISRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [empList, setEmpList] = useState<{ id: string; full_name: string; employee_code: string; designation: string | null }[]>([]);
  const [imgBusy, setImgBusy] = useState(false);
  const [empFilter, setEmpFilter] = useState('all');

  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';

  useEffect(() => {
    if (!isAdmin) return;
    supabase.from('nw_employees').select('id, full_name, employee_code, designation').eq('status', 'active').order('full_name')
      .then(({ data }) => setEmpList((data as any[]) || []));
  }, [isAdmin]);

  const years = Array.from({ length: 5 }, (_, i) => today.getFullYear() - i);

  const { startDate, endDate } = monthRange(selectedYear, selectedMonth);

  // Which clients this viewer's report covers: an admin sees everyone (or the
  // one employee they filtered to), an RM only their own book.
  const loadScopedClients = useCallback(async (): Promise<NWClient[]> => {
    let q = supabase.from('nw_clients').select('id, full_name, client_code, employee_id, sourced_via');
    if (!isAdmin) q = q.eq('employee_id', employee.id);
    else if (empFilter !== 'all') q = q.eq('employee_id', empFilter);
    const { data } = await q;
    return (data as NWClient[]) || [];
  }, [isAdmin, empFilter, employee.id]);

  const calculate = useCallback(async () => {
    setLoading(true);
    const clientList = await loadScopedClients();
    const computed = await computeMisRows(clientList, startDate, endDate, selectedYear, selectedMonth);
    setRows(computed);
    setLoading(false);
    setHasLoaded(true);
  }, [selectedYear, selectedMonth, startDate, endDate, loadScopedClients]);

  // ---------------------------------------------------------------------
  // Employee-wise revenue card (PNG) for the team group.
  //
  // Deliberately NOT derived from `rows`: that set is scoped to the employee
  // filter, so building the card from it would silently produce a one-person
  // "team" sheet whenever a filter was left applied. It re-runs the same engine
  // over every client instead, so the card always means the same thing.
  // ---------------------------------------------------------------------
  const downloadTeamImage = useCallback(async () => {
    setImgBusy(true);
    try {
      const { data: clientData } = await supabase
        .from('nw_clients').select('id, full_name, client_code, employee_id, sourced_via');
      const allClients = (clientData as NWClient[]) || [];
      const allRows = await computeMisRows(allClients, startDate, endDate, selectedYear, selectedMonth);

      const byEmp = new Map<string, { revenue: number; entries: number }>();
      for (const r of allRows) {
        if (!r.employee_id) continue;          // unassigned client — no one to credit
        const cur = byEmp.get(r.employee_id) ?? { revenue: 0, entries: 0 };
        cur.revenue += r.revenue;
        // Pending rows sit at ₹0 on purpose; they are not an earning entry.
        if (r.revenue !== 0) cur.entries += 1;
        byEmp.set(r.employee_id, cur);
      }

      // Everyone stays on the card, including a zero month — a blank line is
      // the whole point of a progression review.
      const entries = empList
        .filter(e => !isExcludedFromTeamCard(e))
        .map(e => ({
          full_name:     e.full_name,
          employee_code: e.employee_code,
          designation:   e.designation,
          revenue:       byEmp.get(e.id)?.revenue ?? 0,
          entries:       byEmp.get(e.id)?.entries ?? 0,
        }));

      await generateTeamRevenueImage({
        entries,
        monthLabel:  `${MONTHS[selectedMonth]} ${selectedYear}`,
        periodLabel: `${fmtDate(startDate)} – ${fmtDate(endDate)}`,
        generatedBy: employee.full_name,
      });
    } finally {
      setImgBusy(false);
    }
  }, [startDate, endDate, selectedYear, selectedMonth, empList, employee.full_name]);

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const byType = {
    landing_cost: rows.filter(r => r.revenue_type === 'landing_cost').reduce((s, r) => s + r.revenue, 0),
    insurance: rows.filter(r => r.revenue_type === 'insurance').reduce((s, r) => s + r.revenue, 0),
    trail: rows.filter(r => r.revenue_type === 'trail').reduce((s, r) => s + r.revenue, 0),
  };

  const revenueTypeLabel: Record<string, string> = {
    landing_cost: 'Unlisted / Bonds',
    insurance: 'Insurance',
    trail: 'MF Trail',
  };
  // RGB triplets so on-screen badges can composite tint + solid via rgba()/rgb().
  const revenueTypeColor: Record<string, string> = {
    landing_cost: 'var(--accent-rgb)',
    insurance: '249, 115, 22',
    trail: '236, 72, 153',
  };

  const printMIS = () => {
    const logoHtml = `<div style="font-weight:900;font-size:22px;color:#111;font-family:Georgia,serif;">Niyom Wealth</div>`;

    const rowsHtml = rows.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td style="white-space:nowrap">${fmtDate(r.date)}</td>
        <td><strong>${r.client_name}</strong><br><span style="color:#888;font-size:11px">${r.client_code}</span></td>
        <td>${PRODUCT_LABELS[r.product_type] || r.product_type}</td>
        <td>${r.product_name}</td>
        <td>${revenueTypeLabel[r.revenue_type]}</td>
        <td>${r.notes}</td>
        <td style="text-align:right;font-weight:700;color:${r.revenue >= 0 ? '#059669' : '#DC2626'}">
          ${r.revenue >= 0 ? '' : '-'}&#8377;${Math.abs(r.revenue).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
        </td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>MIS Report — ${MONTHS[selectedMonth]} ${selectedYear}</title>
  <style>
    @page { margin: 18mm 14mm; }
    body { font-family: Arial, sans-serif; color: #111; font-size: 12px; }
    .header { display:flex; align-items:center; justify-content:space-between; border-bottom:3px solid #d4af37; padding-bottom:12px; margin-bottom:16px; }
    .period { font-size:11px; color:#888; }
    .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:20px; }
    .stat { background:#f8f8f8; border-radius:6px; padding:10px 12px; border-top:3px solid #eee; }
    .stat-label { font-size:9px; color:#999; text-transform:uppercase; letter-spacing:0.08em; }
    .stat-value { font-size:16px; font-weight:800; margin-top:3px; }
    table { width:100%; border-collapse:collapse; }
    th { background:#f2f2f2; padding:7px 9px; text-align:left; font-size:10px; text-transform:uppercase; color:#777; border-bottom:1px solid #e0e0e0; }
    td { padding:7px 9px; border-bottom:1px solid #f0f0f0; font-size:11px; vertical-align:top; }
    .footer { margin-top:28px; text-align:center; font-size:10px; color:#aaa; border-top:1px solid #eee; padding-top:10px; }
  </style>
</head>
<body>
  <div class="header">
    <div>${logoHtml}<div class="period">MIS Report &nbsp;&middot;&nbsp; ${MONTHS[selectedMonth]} ${selectedYear} &nbsp;&middot;&nbsp; ${startDate} to ${endDate}</div></div>
    <div style="text-align:right"><div style="font-size:20px;font-weight:800;color:#059669">&#8377;${totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div><div style="font-size:10px;color:#888">Total Revenue</div></div>
  </div>
  <div class="stats">
    <div class="stat" style="border-top-color:#d4af37"><div class="stat-label">Unlisted / Bonds</div><div class="stat-value" style="color:#d4af37">&#8377;${byType.landing_cost.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div></div>
    <div class="stat" style="border-top-color:#f97316"><div class="stat-label">Insurance</div><div class="stat-value" style="color:#f97316">&#8377;${byType.insurance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div></div>
    <div class="stat" style="border-top-color:#ec4899"><div class="stat-label">MF Trail</div><div class="stat-value" style="color:#ec4899">&#8377;${byType.trail.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div></div>
    <div class="stat" style="border-top-color:#059669"><div class="stat-label">Total Entries</div><div class="stat-value">${rows.length}</div></div>
  </div>
  <table>
    <thead><tr><th>#</th><th>Date</th><th>Client</th><th>Product Type</th><th>Product</th><th>Revenue Type</th><th>Details</th><th style="text-align:right">Revenue</th></tr></thead>
    <tbody>${rowsHtml || '<tr><td colspan="8" style="text-align:center;padding:20px;color:#aaa">No revenue entries for this period</td></tr>'}</tbody>
  </table>
  <div class="footer">Niyom Wealth Distribution &nbsp;&middot;&nbsp; Confidential &nbsp;&middot;&nbsp; Generated ${new Date().toLocaleString('en-IN')}</div>
</body>
</html>`;

    const w = window.open('', '_blank');
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>Revenue</p>
          <h1 className="text-2xl font-bold text-text-primary">MIS Report</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Revenue is counted in the month the payment was received, not the month the deal was booked.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && (
            <button onClick={downloadTeamImage} disabled={imgBusy}
              title="Employee-wise revenue for the selected month, as a single image to share with the team"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: 'rgba(var(--accent-rgb),0.10)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.35)' }}>
              <ImageIcon className="w-4 h-4" />
              {imgBusy ? 'Building image…' : 'Team Revenue Image'}
            </button>
          )}
          {hasLoaded && rows.length > 0 && (
            <button onClick={printMIS}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              <Download className="w-4 h-4" /> Download PDF
            </button>
          )}
          <button onClick={calculate} disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-on-accent disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
            <BarChart3 className="w-4 h-4" />
            {loading ? 'Calculating...' : 'Generate MIS'}
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total Revenue', value: fmt(totalRevenue), color: 'var(--success)' },
            { label: 'Unlisted / Bonds', value: fmt(byType.landing_cost), color: 'var(--accent)' },
            { label: 'Insurance', value: fmt(byType.insurance), color: 'var(--chart-6)' },
            { label: 'MF Trail', value: fmt(byType.trail), color: 'var(--chart-4)' },
          ].map(s => (
            <div key={s.label} className="rounded-2xl p-5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-faint)' }}>{s.label}</p>
              <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Revenue table */}
      {hasLoaded && (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
            <p className="text-sm font-bold text-text-primary">Revenue Breakdown — {MONTHS[selectedMonth]} {selectedYear}</p>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{rows.length} {rows.length === 1 ? 'entry' : 'entries'}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full nw-table">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {['Date', 'Client', 'Product', 'Type', 'Revenue Type', 'Details', 'Revenue'].map(h => (
                    <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-12 text-sm" style={{ color: 'var(--text-faint)' }}>
                    No revenue entries for {MONTHS[selectedMonth]} {selectedYear}
                  </td></tr>
                ) : rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--bg-raised)' }}>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <p className="text-sm text-text-primary">{fmtDate(r.date)}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-medium text-text-primary">{r.client_name}</p>
                      <p className="text-xs font-mono" style={{ color: 'var(--text-faint)' }}>{r.client_code}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm text-text-primary">{r.product_name}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{PRODUCT_LABELS[r.product_type] || r.product_type}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs font-semibold px-1.5 py-0.5 rounded border" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-strong)' }}>
                        {PRODUCT_LABELS[r.product_type]}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs font-bold px-2 py-1 rounded-lg"
                        style={{ background: `rgba(${revenueTypeColor[r.revenue_type]}, 0.08)`, color: `rgb(${revenueTypeColor[r.revenue_type]})` }}>
                        {revenueTypeLabel[r.revenue_type]}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 max-w-[200px]">
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.notes}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className={`text-sm font-bold ${r.revenue >= 0 ? 'text-c-emerald' : 'text-c-red'}`}>
                        {r.revenue >= 0 ? '' : '-'}{fmt(Math.abs(r.revenue))}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--border)' }}>
                    <td colSpan={6} className="px-5 py-3.5 text-sm font-bold text-text-primary">Total Revenue</td>
                    <td className="px-5 py-3.5 text-sm font-bold text-c-emerald">{fmt(totalRevenue)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {!hasLoaded && (
        <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <BarChart3 className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--border-strong)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--text-faint)' }}>Select a period and click Generate MIS</p>
          <p className="text-xs mt-1" style={{ color: 'var(--border-strong)' }}>Revenue is calculated based on holdings data entered by your team</p>
        </div>
      )}
    </div>

    
  );
}
