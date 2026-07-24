import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { NWEmployee, NWHolding, NWTransaction, NWClient, ProductType } from './types';
import { fmt, fmtDate, PRODUCT_LABELS, PRODUCT_CHART_COLORS, TXN_LABELS, TXN_COLORS } from './utils';
import { Download, BarChart3, ArrowLeftRight, Users, ChevronDown } from 'lucide-react';

interface Props { employee: NWEmployee; }

type ReportMode = 'portfolio' | 'transactions' | 'clients';

export default function Reports({ employee }: Props) {
  const [mode, setMode] = useState<ReportMode>('portfolio');
  const [holdings, setHoldings] = useState<(NWHolding & { client?: { full_name: string; client_code: string; employee_id: string } })[]>([]);
  const [txns, setTxns] = useState<NWTransaction[]>([]);
  const [clients, setClients] = useState<NWClient[]>([]);
  const [empList, setEmpList] = useState<{ id: string; full_name: string; employee_code: string }[]>([]);
  const [clientFilter, setClientFilter] = useState('all');
  const [empFilter, setEmpFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(false);

  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [holdRes, txnRes, clientRes] = await Promise.all([
        supabase.from('nw_holdings').select('*, client:nw_clients(full_name, client_code, employee_id)'),
        supabase.from('nw_transactions').select('*, client:nw_clients(full_name, client_code, employee_id)').order('txn_date', { ascending: false }),
        supabase.from('nw_clients').select('*, employee:nw_employees(full_name, employee_code)').order('created_at', { ascending: false }),
      ]);

      let hList = (holdRes.data as (NWHolding & { client: any })[]) || [];
      let tList = (txnRes.data as (NWTransaction & { client: any })[]) || [];
      let cList = (clientRes.data as (NWClient & { employee: any })[]) || [];

      if (!isAdmin) {
        hList = hList.filter(h => h.client?.employee_id === employee.id);
        tList = tList.filter(t => t.client?.employee_id === employee.id);
        cList = cList.filter(c => c.employee_id === employee.id);
      }

      setHoldings(hList);
      setTxns(tList);
      setClients(cList);
      setLoading(false);
    };
    load();
    if (isAdmin) {
      supabase.from('nw_employees').select('id, full_name, employee_code').eq('status', 'active').order('full_name')
        .then(({ data }) => setEmpList((data as any[]) || []));
    }
  }, [isAdmin, employee.id]);

  const filteredTxns = txns.filter(t => {
    if (empFilter !== 'all' && (t.client as any)?.employee_id !== empFilter) return false;
    if (clientFilter !== 'all' && t.client_id !== clientFilter) return false;
    if (dateFrom && t.txn_date < dateFrom) return false;
    if (dateTo && t.txn_date > dateTo) return false;
    return true;
  });

  const filteredClients = clients.filter(c => empFilter === 'all' || c.employee_id === empFilter);

  const filteredHoldings = holdings.filter(h => {
    if (empFilter !== 'all' && (h.client as any)?.employee_id !== empFilter) return false;
    if (clientFilter !== 'all' && h.client_id !== clientFilter) return false;
    return true;
  });

  // Group holdings by product type for bar chart
  const productBreakdown = Object.entries(
    filteredHoldings.reduce((acc, h) => {
      acc[h.product_type] = (acc[h.product_type] || 0) + (h.current_value || 0);
      return acc;
    }, {} as Record<ProductType, number>)
  ).sort((a, b) => b[1] - a[1]);

  const maxBarValue = productBreakdown.length > 0 ? Math.max(...productBreakdown.map(([, v]) => v)) : 1;

  const exportCSV = () => {
    let headers: string[], rows: any[][];
    if (mode === 'portfolio') {
      headers = ['Product', 'Type', 'Qty', 'Invested', 'Current Value', 'P&L'];
      rows = filteredHoldings.map(h => [h.product_name, PRODUCT_LABELS[h.product_type], h.quantity, h.invested_amount, h.current_value, (h.current_value || 0) - (h.invested_amount || 0)]);
    } else if (mode === 'transactions') {
      headers = ['Date', 'Client', 'Type', 'Product', 'Amount'];
      rows = filteredTxns.map(t => [t.txn_date, (t.client as any)?.full_name, TXN_LABELS[t.txn_type], t.product_name, t.consolidated_amount]);
    } else {
      headers = ['Client', 'Code', 'Employee', 'Portfolio', 'Status', 'Date'];
      rows = filteredClients.map(c => [c.full_name, c.client_code, (c.employee as any)?.full_name || 'Admin', c.portfolio_value, c.verification_status, fmtDate(c.created_at)]);
    }
    const csv = [headers, ...rows].map(r => r.map(v => `"${v || ''}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = 'data:text/csv,' + encodeURIComponent(csv); a.download = `${mode}-report.csv`; a.click();
  };

  const modes = [
    { key: 'portfolio' as ReportMode, label: 'Portfolio', icon: BarChart3 },
    { key: 'transactions' as ReportMode, label: 'Transactions', icon: ArrowLeftRight },
    { key: 'clients' as ReportMode, label: 'Clients', icon: Users },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>Analytics</p>
          <h1 className="text-2xl font-bold text-text-primary">Reports</h1>
        </div>
        <button onClick={exportCSV} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        {modes.map(m => {
          const Icon = m.icon;
          const active = mode === m.key;
          return (
            <button key={m.key} onClick={() => setMode(m.key)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={active ? { background: 'rgba(var(--accent-rgb),0.1)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.2)' } : { color: 'var(--text-muted)', border: '1px solid transparent' }}>
              <Icon className="w-4 h-4" />{m.label}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        {isAdmin && (
          <div className="relative">
            <select value={empFilter} onChange={e => { setEmpFilter(e.target.value); setClientFilter('all'); }}
              className="pl-3 pr-8 py-2.5 rounded-xl text-sm text-text-primary outline-none appearance-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(var(--accent-rgb),0.4)' }}>
              <option value="all">All Employees</option>
              {empList.map(e => <option key={e.id} value={e.id}>{e.full_name} ({e.employee_code})</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--accent)' }} />
          </div>
        )}
        <div className="relative">
          <select value={clientFilter} onChange={e => setClientFilter(e.target.value)}
            className="pl-3 pr-8 py-2.5 rounded-xl text-sm text-text-primary outline-none appearance-none"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <option value="all">All Clients</option>
            {filteredClients.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-faint)' }} />
        </div>
        {mode === 'transactions' && (
          <>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} placeholder="From"
              className="px-3 py-2.5 rounded-xl text-sm text-text-primary outline-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} placeholder="To"
              className="px-3 py-2.5 rounded-xl text-sm text-text-primary outline-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
          </>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} /></div>
      ) : (
        <>
          {mode === 'portfolio' && (
            <div className="space-y-5">
              {/* Bar chart by product */}
              <div className="rounded-2xl p-6" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                <h2 className="text-sm font-bold text-text-primary mb-5">Portfolio by Product Type</h2>
                {productBreakdown.length === 0 ? (
                  <p className="text-sm text-center py-8" style={{ color: 'var(--text-faint)' }}>No holdings data</p>
                ) : (
                  <div className="space-y-4">
                    {productBreakdown.map(([type, value]) => (
                      <div key={type} className="flex items-center gap-4">
                        <p className="text-xs font-semibold w-32 flex-shrink-0 text-text-primary">{PRODUCT_LABELS[type as ProductType]}</p>
                        <div className="flex-1 h-8 rounded-lg overflow-hidden" style={{ background: 'var(--bg-raised)' }}>
                          <div className="h-full rounded-lg flex items-center px-3 transition-all" style={{ width: `${(value / maxBarValue) * 100}%`, background: PRODUCT_CHART_COLORS[type as ProductType] + '40', borderRight: `2px solid ${PRODUCT_CHART_COLORS[type as ProductType]}` }}>
                          </div>
                        </div>
                        <p className="text-sm font-bold text-text-primary w-24 text-right flex-shrink-0">{fmt(value)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Holdings table */}
              <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                <div className="overflow-x-auto">
                  <table className="w-full nw-table">
                    <thead><tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      {['Product', 'Client', 'Type', 'Invested', 'Current Value', 'P&L'].map(h => (
                        <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {filteredHoldings.map(h => {
                        const pl = (h.current_value || 0) - (h.invested_amount || 0);
                        return (
                          <tr key={h.id} style={{ borderBottom: '1px solid var(--bg-raised)' }}>
                            <td className="px-5 py-3.5 text-sm font-medium text-text-primary">{h.product_name}</td>
                            <td className="px-5 py-3.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{(h as any).client?.full_name || '—'}</td>
                            <td className="px-5 py-3.5"><span className="text-xs px-1.5 py-0.5 rounded" style={{ background: PRODUCT_CHART_COLORS[h.product_type] + '20', color: PRODUCT_CHART_COLORS[h.product_type] }}>{PRODUCT_LABELS[h.product_type]}</span></td>
                            <td className="px-5 py-3.5 text-sm text-text-primary">{fmt(h.invested_amount || 0)}</td>
                            <td className="px-5 py-3.5 text-sm font-bold text-text-primary">{fmt(h.current_value || 0)}</td>
                            <td className="px-5 py-3.5"><span className={`text-sm font-bold ${pl >= 0 ? 'text-c-emerald' : 'text-c-red'}`}>{pl >= 0 ? '+' : ''}{fmt(pl)}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {mode === 'transactions' && (
            <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <div className="overflow-x-auto">
                <table className="w-full nw-table">
                  <thead><tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    {['Date', 'Client', 'Type', 'Product', 'Amount'].map(h => (
                      <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {filteredTxns.length === 0 ? (
                      <tr><td colSpan={5} className="text-center py-12 text-sm" style={{ color: 'var(--text-faint)' }}>No transactions in range</td></tr>
                    ) : filteredTxns.map(t => (
                      <tr key={t.id} style={{ borderBottom: '1px solid var(--bg-raised)' }}>
                        <td className="px-5 py-3.5 text-xs" style={{ color: 'var(--text-muted)' }}>{fmtDate(t.txn_date)}</td>
                        <td className="px-5 py-3.5 text-sm text-text-primary">{(t.client as any)?.full_name || '—'}</td>
                        <td className="px-5 py-3.5"><span className={`text-xs font-bold px-2 py-1 rounded-lg ${TXN_COLORS[t.txn_type]}`}>{TXN_LABELS[t.txn_type]}</span></td>
                        <td className="px-5 py-3.5 text-sm text-text-primary">{t.product_name}</td>
                        <td className="px-5 py-3.5 text-sm font-bold text-text-primary">{fmt(t.consolidated_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {mode === 'clients' && (
            <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <div className="overflow-x-auto">
                <table className="w-full nw-table">
                  <thead><tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    {['Client', 'Code', ...(isAdmin ? ['Employee'] : []), 'Portfolio', 'Status', 'Joined'].map(h => (
                      <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {filteredClients.length === 0 ? (
                      <tr><td colSpan={isAdmin ? 6 : 5} className="text-center py-12 text-sm" style={{ color: 'var(--text-faint)' }}>No clients</td></tr>
                    ) : filteredClients.map(c => (
                      <tr key={c.id} style={{ borderBottom: '1px solid var(--bg-raised)' }}>
                        <td className="px-5 py-3.5">
                          <p className="text-sm font-medium text-text-primary">{c.full_name}</p>
                          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{c.email || c.phone}</p>
                        </td>
                        <td className="px-5 py-3.5"><span className="text-xs font-mono px-2 py-1 rounded" style={{ background: 'var(--bg-raised)', color: 'var(--accent)' }}>{c.client_code}</span></td>
                        {isAdmin && <td className="px-5 py-3.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{(c.employee as any)?.full_name || 'Admin'}</td>}
                        <td className="px-5 py-3.5 text-sm font-bold text-text-primary">{fmt(c.portfolio_value || 0)}</td>
                        <td className="px-5 py-3.5 text-xs capitalize text-text-primary">{c.verification_status}</td>
                        <td className="px-5 py-3.5 text-xs" style={{ color: 'var(--text-muted)' }}>{fmtDate(c.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
