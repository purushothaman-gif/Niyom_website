import { useEffect, useState } from 'react';
import { LogoLoader } from '../components/LogoLoader';
import { supabase } from '../lib/supabase';
import { NWEmployee, NWTransaction, NWActivityLog, NWClient } from './types';
import { fmt, fmtDate, timeAgo, TXN_LABELS, TXN_COLORS, VERIFICATION_COLORS, VERIFICATION_LABELS } from './utils';
import { Users, TrendingUp, ArrowLeftRight, UserCheck, ArrowRight, Activity, BarChart2 } from 'lucide-react';
import { CRMPage } from './types';
import { Counter } from '../components/Reveal';
import { HeroBackground } from '../components/HeroBackground';
import { EmployeeAvatar } from './EmployeeAvatar';

interface Props { employee: NWEmployee; onNavigate: (page: CRMPage) => void; }

interface Stats {
  totalClients: number;
  totalPortfolio: number;
  verifiedClients: number;
  monthlyTxns: number;
  totalEmployees?: number;
}

interface EmployeeStat {
  id: string;
  full_name: string;
  employee_code: string;
  avatar_url: string | null;
  clientCount: number;
  portfolioValue: number;
  verifiedCount: number;
}

export default function Dashboard({ employee, onNavigate }: Props) {
  const [stats, setStats] = useState<Stats>({ totalClients: 0, totalPortfolio: 0, verifiedClients: 0, monthlyTxns: 0 });
  const [recentTxns, setRecentTxns] = useState<NWTransaction[]>([]);
  /*
   * Exactly the columns the dashboard query selects — NOT a full NWClient,
   * which has 24 more it never asks for. Claiming the full type was a lie the
   * compiler happened to catch; naming the real shape also lets the row drop
   * its `(c as any).employee` escape hatch.
   */
  type RecentClient = Pick<
    NWClient,
    'id' | 'full_name' | 'client_code' | 'phone' | 'email' | 'portfolio_value' | 'verification_status' | 'created_at'
  > & { employee?: { full_name: string; employee_code: string } | null };

  const [recentClients, setRecentClients] = useState<RecentClient[]>([]);
  const [activity, setActivity] = useState<NWActivityLog[]>([]);
  const [employeeStats, setEmployeeStats] = useState<EmployeeStat[]>([]);
  const [loading, setLoading] = useState(true);

  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];

      const clientsQuery = supabase
        .from('nw_clients')
        .select('id, portfolio_value, verification_status, full_name, client_code, employee_id, created_at, phone, email, employee:nw_employees(full_name, employee_code)')
        .order('created_at', { ascending: false });

      const txnsQuery = supabase
        .from('nw_transactions')
        .select('*, client:nw_clients(full_name, client_code)')
        .order('created_at', { ascending: false })
        .limit(10);

      const activityQuery = supabase
        .from('nw_activity_logs')
        .select('*, employee:nw_employees(full_name)')
        .order('created_at', { ascending: false })
        .limit(20);

      const [clientsRes, txnsRes, activityRes] = await Promise.all([
        clientsQuery, txnsQuery, activityQuery,
      ]);

      const allClients = clientsRes.data || [];
      const allTxns = txnsRes.data || [];

      const clients = isAdmin ? allClients : allClients.filter(c => c.employee_id === employee.id);
      const txns = allTxns;

      const monthTxns = txns.filter(t => t.txn_date >= monthStart);
      const totalPortfolio = clients.reduce((s, c) => s + (c.portfolio_value || 0), 0);
      const verifiedClients = clients.filter(c => c.verification_status === 'verified').length;

      let empCount: number | undefined;
      if (isAdmin) {
        const { data: empData, count } = await supabase
          .from('nw_employees')
          .select('id, full_name, employee_code, avatar_url', { count: 'exact' })
          .eq('status', 'active');

        empCount = count || 0;

        // Build per-employee stats from client data
        if (empData) {
          const statsMap: Record<string, EmployeeStat> = {};
          for (const e of empData) {
            statsMap[e.id] = { id: e.id, full_name: e.full_name, employee_code: e.employee_code, avatar_url: (e as any).avatar_url ?? null, clientCount: 0, portfolioValue: 0, verifiedCount: 0 };
          }
          // Bucket 'unassigned' for clients with no employee
          statsMap['__unassigned__'] = { id: '__unassigned__', full_name: 'Unassigned', employee_code: '—', avatar_url: null, clientCount: 0, portfolioValue: 0, verifiedCount: 0 };

          for (const c of allClients) {
            const key = c.employee_id && statsMap[c.employee_id] ? c.employee_id : '__unassigned__';
            statsMap[key].clientCount++;
            statsMap[key].portfolioValue += c.portfolio_value || 0;
            if (c.verification_status === 'verified') statsMap[key].verifiedCount++;
          }

          const sorted = Object.values(statsMap)
            .filter(s => s.id === '__unassigned__' ? s.clientCount > 0 : true)
            .sort((a, b) => b.portfolioValue - a.portfolioValue);
          setEmployeeStats(sorted);
        }
      }

      setStats({ totalClients: clients.length, totalPortfolio, verifiedClients, monthlyTxns: monthTxns.length, totalEmployees: empCount });
      setRecentTxns(txns.slice(0, 5) as NWTransaction[]);
      /*
       * Two-step cast, deliberately. supabase-js cannot type an embedded
       * relation without generated Database types, and infers `employee` as an
       * ARRAY where PostgREST actually returns an object for a many-to-one FK.
       * Generating those types would remove the need for this entirely.
       */
      setRecentClients(clients.slice(0, 5) as unknown as RecentClient[]);
      setActivity(activityRes.data || []);
      setLoading(false);
    };
    load();
  }, [isAdmin]);

  const statCards: Array<{ label: string; value: string; numeric?: number; icon: typeof Users; color: string; sub: string }> = [
    { label: isAdmin ? 'Total Clients' : 'My Clients', value: stats.totalClients.toString(), numeric: stats.totalClients, icon: Users, color: 'var(--info)', sub: 'Active clients' },
    { label: isAdmin ? 'Total Portfolio' : 'My Portfolio', value: fmt(stats.totalPortfolio), icon: TrendingUp, color: 'var(--accent)', sub: 'Under management' },
    { label: 'Verified Clients', value: stats.verifiedClients.toString(), numeric: stats.verifiedClients, icon: UserCheck, color: 'var(--success)', sub: `of ${stats.totalClients} total` },
    { label: 'Monthly Transactions', value: stats.monthlyTxns.toString(), numeric: stats.monthlyTxns, icon: ArrowLeftRight, color: 'var(--warning)', sub: 'This month' },
    ...(isAdmin && stats.totalEmployees !== undefined ? [{ label: 'Total Employees', value: stats.totalEmployees.toString(), numeric: stats.totalEmployees, icon: Users, color: 'var(--chart-4)', sub: 'Active staff' }] : []),
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LogoLoader size={52} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome banner — the animated brand network (dark-pinned, so it reads
          the same in both app themes) brings the public-site / login identity
          into the CRM without touching the dense data views below. */}
      <div data-theme="dark" className="relative overflow-hidden rounded-2xl p-6 sm:p-8" style={{ border: '1px solid var(--border)' }}>
        <HeroBackground />
        <div className="relative z-10">
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>Overview</p>
          <h1 className="text-2xl font-bold text-text-primary">Welcome back, {employee.full_name.split(' ')[0]}</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {isAdmin ? 'Full portfolio view across all employees' : "Here's what's happening across your portfolio"}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className={`grid gap-4 ${isAdmin ? 'grid-cols-2 lg:grid-cols-5' : 'grid-cols-2 lg:grid-cols-4'}`}>
        {statCards.map((s, i) => {
          const Icon = s.icon;
          const delay = ['', 'animate-delay-100', 'animate-delay-200', 'animate-delay-300', 'animate-delay-400'][i] || '';
          return (
            <div key={s.label} className={`lift rounded-2xl p-5 animate-fadeInUp ${delay}`} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{s.label}</p>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `color-mix(in srgb, ${s.color} 12%, transparent)` }}>
                  <Icon className="w-4 h-4" style={{ color: s.color }} />
                </div>
              </div>
              <p className="text-3xl font-bold text-text-primary tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
                {s.numeric !== undefined ? <Counter value={s.numeric} durationMs={1100} /> : s.value}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>{s.sub}</p>
            </div>
          );
        })}
      </div>

      {/* Admin: Employee Breakdown */}
      {isAdmin && employeeStats.length > 0 && (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <BarChart2 className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <h2 className="text-sm font-bold text-text-primary">Employee Breakdown</h2>
            <span className="text-xs ml-1" style={{ color: 'var(--text-faint)' }}>— clients & AUM per employee</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full nw-table">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {['Employee', 'Code', 'Clients', 'Verified', 'Portfolio AUM', 'Share'].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employeeStats.map((es, i) => {
                  const pct = stats.totalPortfolio > 0 ? (es.portfolioValue / stats.totalPortfolio) * 100 : 0;
                  return (
                    <tr key={es.id} style={{ borderBottom: '1px solid var(--bg-raised)' }}>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <EmployeeAvatar name={es.full_name} url={es.avatar_url} size={28} rounded="full"
                            badgeStyle={{ background: i === 0 ? 'rgba(var(--accent-rgb),0.15)' : 'rgba(var(--hover-bg-rgb),0.05)', color: i === 0 ? 'var(--accent)' : 'var(--text-muted)' }} />
                          <span className="text-sm font-medium text-text-primary">{es.full_name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-xs font-mono px-2 py-1 rounded" style={{ background: 'var(--bg-raised)', color: 'var(--accent)' }}>{es.employee_code}</span>
                      </td>
                      <td className="px-5 py-3.5 text-sm font-semibold text-text-primary">{es.clientCount}</td>
                      <td className="px-5 py-3.5">
                        <span className="text-sm text-c-emerald font-semibold">{es.verifiedCount}</span>
                        <span className="text-xs ml-1" style={{ color: 'var(--text-faint)' }}>/ {es.clientCount}</span>
                      </td>
                      <td className="px-5 py-3.5 text-sm font-semibold text-text-primary">{fmt(es.portfolioValue)}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--accent), var(--accent-strong))' }} />
                          </div>
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{pct.toFixed(1)}%</span>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Transactions */}
        <div className="lg:col-span-2 rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
            <h2 className="text-sm font-bold text-text-primary">Recent Transactions</h2>
            <button onClick={() => onNavigate('transactions')} className="text-xs flex items-center gap-1" style={{ color: 'var(--accent)' }}>
              View all <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {recentTxns.length === 0 ? (
              <p className="text-sm text-center py-10" style={{ color: 'var(--text-faint)' }}>No transactions yet</p>
            ) : recentTxns.map(t => (
              <div key={t.id} className="px-5 py-3.5 flex items-center gap-3">
                <div className={`text-xs font-bold px-2 py-1 rounded-lg ${TXN_COLORS[t.txn_type]}`}>
                  {TXN_LABELS[t.txn_type]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{t.product_name}</p>
                  <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{(t.client as any)?.full_name || '—'} · {fmtDate(t.txn_date)}</p>
                </div>
                <p className="text-sm font-bold text-text-primary flex-shrink-0">{fmt(t.consolidated_amount)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Activity Feed */}
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <div className="px-5 py-4 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <Activity className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <h2 className="text-sm font-bold text-text-primary">Activity Feed</h2>
          </div>
          <div className="divide-y p-4 space-y-3 max-h-80 overflow-y-auto" style={{ borderColor: 'var(--border-subtle)' }}>
            {activity.length === 0 ? (
              <p className="text-sm text-center py-6" style={{ color: 'var(--text-faint)' }}>No recent activity</p>
            ) : activity.map(a => (
              <div key={a.id} className="flex gap-3">
                <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ background: 'var(--accent)' }} />
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-xs font-semibold text-text-primary">{a.action}</p>
                    {isAdmin && (a as any).employee?.full_name && (
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(var(--accent-rgb),0.08)', color: 'var(--accent)' }}>
                        {(a as any).employee.full_name}
                      </span>
                    )}
                  </div>
                  {a.description && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{a.description}</p>}
                  <p className="text-xs mt-0.5" style={{ color: 'var(--border-stronger)' }}>{timeAgo(a.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Clients */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-sm font-bold text-text-primary">Recent Clients</h2>
          <button onClick={() => onNavigate('clients')} className="text-xs flex items-center gap-1" style={{ color: 'var(--accent)' }}>
            View all <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                {['Client', 'Code', ...(isAdmin ? ['Managed By'] : []), 'Portfolio', 'Status', 'Date'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentClients.length === 0 ? (
                <tr><td colSpan={isAdmin ? 6 : 5} className="text-center py-10 text-sm" style={{ color: 'var(--text-faint)' }}>No clients yet</td></tr>
              ) : recentClients.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--bg-raised)' }}>
                  <td className="px-5 py-3.5">
                    <p className="text-sm font-medium text-text-primary">{c.full_name}</p>
                    <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{c.phone || c.email || '—'}</p>
                  </td>
                  <td className="px-5 py-3.5"><span className="text-xs font-mono px-2 py-1 rounded" style={{ background: 'var(--bg-raised)', color: 'var(--accent)' }}>{c.client_code}</span></td>
                  {isAdmin && (
                    <td className="px-5 py-3.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {c.employee?.full_name || <span style={{ color: 'var(--border-stronger)' }}>Unassigned</span>}
                    </td>
                  )}
                  <td className="px-5 py-3.5 text-sm font-semibold text-text-primary">{fmt(c.portfolio_value || 0)}</td>
                  <td className="px-5 py-3.5">
                    <span className={`text-xs font-semibold px-2 py-1 rounded-lg border ${VERIFICATION_COLORS[c.verification_status]}`}>
                      {VERIFICATION_LABELS[c.verification_status]}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-xs" style={{ color: 'var(--text-muted)' }}>{fmtDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
