import { useCallback, useEffect, useState } from 'react';
import { LogoLoader } from '../../components/LogoLoader';
import { supabase } from '../../lib/supabase';
import { NWEmployee } from '../types';
import { Activity as ActivityIcon } from 'lucide-react';
import { isAdminRole, relativeTime } from './leadUtils';
import { statusRgb, priorityRgb } from './leadConstants';
import {
  Card, StatTile, BarList, Columns, Donut, Funnel, TrendLine, Datum, paletteAt,
} from './LeadCharts';
import LeadReminders from './LeadReminders';

interface Props {
  employee: NWEmployee;
  refreshKey: number;
  onOpenLead: (leadId: string) => void;
}

interface Dash {
  scope: 'admin' | 'employee';
  totals: { active: number; today: number; assigned: number; interested: number; converted: number; lost: number; all: number; conversion_rate: number };
  followups: { today: number; overdue: number; missed: number };
  today_calls: number;
  by_status: Datum[]; by_source: Datum[]; by_product: Datum[]; by_priority: Datum[];
  by_origin: Datum[]; funnel: Datum[]; monthly_trend: Datum[]; daily_calls: Datum[];
  self_vs_assigned: { self: number; assigned: number };
  by_employee: { label: string; total: number; converted: number }[];
}

interface ActRow { id: string; action: string; description: string; created_at: string; lead_id: string; lead?: { lead_name: string } | null; employee?: { full_name: string } | null; }

const ORIGIN_LABEL: Record<string, string> = { admin_upload: 'Admin Upload', admin_manual: 'Admin Manual', employee_manual: 'Self-Generated' };

export default function LeadDashboard({ employee, refreshKey, onOpenLead }: Props) {
  const isAdmin = isAdminRole(employee);
  const [d, setD] = useState<Dash | null>(null);
  const [acts, setActs] = useState<ActRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [localKey, setLocalKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const [dash, act] = await Promise.all([
      supabase.rpc('nw_lead_dashboard'),
      supabase.from('nw_lead_activities')
        .select('id, action, description, created_at, lead_id, lead:nw_leads(lead_name), employee:nw_employees(full_name)')
        .order('created_at', { ascending: false }).limit(12),
    ]);
    setD(dash.data as unknown as Dash);
    setActs((act.data as unknown as ActRow[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load, refreshKey, localKey]);

  if (loading || !d) {
    return <div className="flex justify-center py-20"><LogoLoader size={48} /></div>;
  }

  const t = d.totals;
  const selfAssigned: Datum[] = [
    { label: 'Self-Generated', count: d.self_vs_assigned?.self ?? 0 },
    { label: 'Admin-Assigned', count: d.self_vs_assigned?.assigned ?? 0 },
  ];
  const originData: Datum[] = (d.by_origin || []).map(o => ({ label: ORIGIN_LABEL[o.label] || o.label, count: o.count }));

  return (
    <div className="space-y-5">
      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label={isAdmin ? 'Total Leads' : 'My Leads'} value={t.active} />
        <StatTile label="Today's Leads" value={t.today} />
        <StatTile label="Interested" value={t.interested} tone="16,185,129" />
        <StatTile label="Follow-ups Today" value={d.followups.today} tone="249,115,22" />
        <StatTile label="Overdue" value={d.followups.overdue} tone="239,68,68" />
        <StatTile label="Conversion" value={`${t.conversion_rate}%`} tone="99,102,241" hint={`${t.converted} converted`} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Assigned" value={t.assigned} />
        <StatTile label="Today's Calls" value={d.today_calls} />
        <StatTile label="Converted" value={t.converted} tone="5,150,105" />
        <StatTile label="Lost" value={t.lost} tone="239,68,68" />
      </div>

      {/* Charts + reminders */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Monthly Lead Trend" subtitle="Leads created, last 6 months" className="lg:col-span-2">
          <TrendLine data={d.monthly_trend} />
        </Card>
        <LeadReminders employee={employee} refreshKey={refreshKey + localKey} onOpenLead={onOpenLead} onChanged={() => setLocalKey(k => k + 1)} />

        <Card title="Conversion Funnel">
          <Funnel data={d.funnel} />
        </Card>
        <Card title="Pipeline by Status">
          <BarList data={d.by_status} colorFor={d0 => statusRgb(d0.label)} />
        </Card>
        <Card title="Priority Distribution">
          <Donut data={d.by_priority} colorFor={d0 => priorityRgb(d0.label)} />
        </Card>

        <Card title="Lead Source Analysis">
          <BarList data={d.by_source} />
        </Card>
        <Card title="Product Interest">
          <Donut data={d.by_product} />
        </Card>
        <Card title="Daily Calls" subtitle="Last 7 days">
          <Columns data={d.daily_calls} color="16,185,129" />
        </Card>

        {isAdmin && (
          <>
            <Card title="Employee Performance" subtitle="Leads owned · converted" className="lg:col-span-2">
              <BarList data={(d.by_employee || []).map(e => ({ label: `${e.label} (${e.converted}✓)`, count: e.total }))} />
            </Card>
            <Card title="Self vs Assigned">
              <Donut data={selfAssigned} />
            </Card>
            <Card title="Lead Origin Report" className="lg:col-span-3">
              <BarList data={originData} colorFor={(_, i) => paletteAt(i)} />
            </Card>
          </>
        )}

        {/* Recent activity */}
        <Card title="Recent Activities" className={isAdmin ? 'lg:col-span-3' : 'lg:col-span-3'}>
          {acts.length === 0 ? (
            <p className="text-xs text-center py-6" style={{ color: 'var(--text-faint)' }}>No recent activity</p>
          ) : (
            <div className="space-y-2">
              {acts.map(a => (
                <button key={a.id} onClick={() => onOpenLead(a.lead_id)} className="w-full flex items-center gap-3 p-2 rounded-lg text-left hover:bg-[var(--hover-bg)]">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(var(--accent-rgb),0.1)' }}>
                    <ActivityIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs" style={{ color: 'var(--text-primary)' }}>
                      <span className="font-semibold">{a.action}</span>
                      {a.lead?.lead_name && <span style={{ color: 'var(--text-faint)' }}> · {a.lead.lead_name}</span>}
                    </p>
                    {a.description && <p className="text-[11px] truncate" style={{ color: 'var(--text-faint)' }}>{a.description}</p>}
                  </div>
                  <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--text-faint)' }}>{relativeTime(a.created_at)}</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
