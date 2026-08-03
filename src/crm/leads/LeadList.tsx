import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LogoLoader } from '../../components/LogoLoader';
import { supabase } from '../../lib/supabase';
import { NWEmployee } from '../types';
import {
  Search, Plus, SlidersHorizontal, X, ChevronLeft, ChevronRight, UserPlus,
  Pencil, Layers, Users2, Sparkles, Inbox, RefreshCw, Upload, Download, Bookmark, Save, ShieldAlert,
  ArrowUp, ArrowDown, ChevronsUpDown,
} from 'lucide-react';
import { NWLead, LeadListFilters, LeadStatus, LeadPriority, LeadOrigin, NWLeadSavedView } from './leadTypes';
import { LEAD_STATUSES, PRIORITIES, INTERESTED_PRODUCTS, LEAD_SOURCES, LEAD_ORIGIN_LABEL, INDIAN_STATES, PAGE_SIZE } from './leadConstants';
import { StatusBadge, PriorityBadge, ScoreBadge, Input, Select } from './leadUi';
import { isAdminRole, formatMoney, formatDate, initials, relativeTime } from './leadUtils';
import { leadsToCsv, downloadCsv } from './leadImportUtils';
import LeadBulkToolbar from './LeadBulkToolbar';

const LEAD_SELECT =
  '*, owner:nw_employees!nw_leads_owner_employee_id_fkey(full_name, employee_code), ' +
  'created_by:nw_employees!nw_leads_created_by_employee_id_fkey(full_name, employee_code)';

const EMPTY_FILTERS: LeadListFilters = {
  search: '', status: '', priority: '', lead_origin: '', owner_employee_id: '',
  scope: 'all', city: '', state: '', product: '', source: '', min_investment: '', max_investment: '',
  date_from: '', date_to: '', include_archived: false,
};

// Table columns. `field` = the nw_leads column used for server-side sorting;
// columns without a field (Owner, actions) aren't sortable.
const COLUMNS: { label: string; field?: string }[] = [
  { label: 'Lead', field: 'lead_name' },
  { label: 'Contact', field: 'mobile' },
  { label: 'City / State', field: 'city' },
  { label: 'Status', field: 'status' },
  { label: 'Priority', field: 'priority' },
  { label: 'Score', field: 'lead_score' },
  { label: 'Owner' },
  { label: 'Investment', field: 'investment_capacity' },
  { label: 'Created', field: 'created_at' },
  { label: '' },
];

interface Props {
  employee: NWEmployee;
  onNew: () => void;
  onOpen: (lead: NWLead) => void;
  onEdit: (lead: NWLead) => void;
  onAssign: (leads: NWLead[]) => void;
  refreshKey: number;               // bump to force a reload from the container
  viewToggle?: React.ReactNode;     // List/Board switch, rendered in the header
  onImport?: () => void;            // admin: open the bulk importer
  onOpenDuplicates?: () => void;    // admin: open the duplicate-review queue
}

export default function LeadList({ employee, onNew, onOpen, onEdit, onAssign, refreshKey, viewToggle, onImport, onOpenDuplicates }: Props) {
  const isAdmin = isAdminRole(employee);
  const [leads, setLeads] = useState<NWLead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<LeadListFilters>(EMPTY_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [employees, setEmployees] = useState<{ id: string; full_name: string }[]>([]);
  const [stats, setStats] = useState({ total: 0, today: 0, pool: 0, converted: 0 });
  const [views, setViews] = useState<NWLeadSavedView[]>([]);
  const [showViews, setShowViews] = useState(false);
  const [saveViewName, setSaveViewName] = useState('');
  const [exporting, setExporting] = useState(false);
  const [dupCount, setDupCount] = useState(0);
  // "Select all matching" — when non-null, the selection spans the whole filtered
  // set (not just the visible page); holds the fetched full rows for bulk ops.
  const [allMatching, setAllMatching] = useState<NWLead[] | null>(null);
  const [selectingAll, setSelectingAll] = useState(false);
  const [selectCount, setSelectCount] = useState(0);   // live progress while fetching
  const [nInput, setNInput] = useState('');            // "select first N" field
  const [sortField, setSortField] = useState<string>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Click a column header: same column toggles direction, new column sorts desc.
  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('desc'); }
    setPage(0);
  };

  useEffect(() => {
    if (!isAdmin) return;
    supabase.from('nw_lead_duplicate_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending')
      .then(({ count }) => setDupCount(count ?? 0));
  }, [isAdmin, refreshKey]);

  const setF = (patch: Partial<LeadListFilters>) => { setFilters(f => ({ ...f, ...patch })); setPage(0); };

  const loadViews = useCallback(() => {
    supabase.from('nw_lead_saved_views').select('*').order('created_at', { ascending: false })
      .then(({ data }) => setViews((data as NWLeadSavedView[]) || []));
  }, []);
  useEffect(() => { loadViews(); }, [loadViews]);

  const applyView = (v: NWLeadSavedView) => {
    const f = { ...EMPTY_FILTERS, ...(v.filters as Partial<LeadListFilters>) };
    setFilters(f); setSearchInput(f.search || ''); setPage(0); setShowViews(false);
  };
  const saveView = async () => {
    if (!saveViewName.trim()) return;
    await supabase.from('nw_lead_saved_views').insert([{ employee_id: employee.id, name: saveViewName.trim(), filters }]);
    setSaveViewName(''); loadViews();
  };
  const deleteView = async (id: string) => { await supabase.from('nw_lead_saved_views').delete().eq('id', id); loadViews(); };

  // Export the current filtered result set (capped) to CSV.
  const exportFiltered = async () => {
    setExporting(true);
    const { data } = await buildQuery(false).order(sortField, { ascending: sortDir === 'asc' }).range(0, 4999);
    const rows = (data as unknown as NWLead[]) || [];
    downloadCsv(`leads_${new Date().toISOString().slice(0, 10)}.csv`, leadsToCsv(rows));
    setExporting(false);
  };

  // Debounce the free-text search box into the filter.
  useEffect(() => {
    const t = setTimeout(() => setF({ search: searchInput.trim() }), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  useEffect(() => {
    if (!isAdmin) return;
    supabase.from('nw_employees').select('id, full_name').eq('status', 'active').order('full_name')
      .then(({ data }) => setEmployees(data || []));
  }, [isAdmin]);

  const buildQuery = useCallback((forCount: boolean) => {
    let q = supabase.from('nw_leads').select(
      forCount ? 'id' : LEAD_SELECT,
      forCount ? { count: 'exact', head: true } : undefined);

    if (!filters.include_archived) q = q.eq('is_archived', false);
    if (filters.status) q = q.eq('status', filters.status);
    if (filters.priority) q = q.eq('priority', filters.priority);
    if (filters.lead_origin) q = q.eq('lead_origin', filters.lead_origin);
    if (filters.product) q = q.eq('interested_product', filters.product);
    if (filters.source) q = q.eq('lead_source', filters.source);
    if (filters.city) q = q.ilike('city', `%${filters.city}%`);
    if (filters.state) q = q.ilike('state', `%${filters.state}%`);
    if (filters.min_investment) q = q.gte('investment_capacity', Number(filters.min_investment));
    if (filters.max_investment) q = q.lte('investment_capacity', Number(filters.max_investment));
    if (filters.date_from) q = q.gte('created_at', filters.date_from);
    if (filters.date_to) q = q.lte('created_at', `${filters.date_to}T23:59:59`);

    // Scope
    if (filters.scope === 'assigned') q = q.eq('owner_employee_id', employee.id);
    // "Self-Generated" = the employee's own manual entries OR public-website
    // self-signups (RLS still limits non-admins to leads they can see).
    else if (filters.scope === 'self_generated')
      q = q.or(`and(created_by_employee_id.eq.${employee.id},lead_origin.eq.employee_manual),lead_origin.eq.website_signup`);
    else if (filters.scope === 'pool') q = q.is('owner_employee_id', null);
    if (isAdmin && filters.owner_employee_id) q = q.eq('owner_employee_id', filters.owner_employee_id);

    if (filters.search) {
      const s = filters.search.replace(/[%,()]/g, ' ').trim();
      if (s) q = q.or(`lead_name.ilike.%${s}%,mobile.ilike.%${s}%,email.ilike.%${s}%,city.ilike.%${s}%,lead_code.ilike.%${s}%`);
    }
    return q;
  }, [filters, isAdmin, employee.id]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await buildQuery(false)
      .order(sortField, { ascending: sortDir === 'asc' })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    setLeads((data as unknown as NWLead[]) || []);
    setSelected(new Set());
    setAllMatching(null);
    setLoading(false);
  }, [buildQuery, page, sortField, sortDir]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Total of the filtered set — recomputed ONLY when filters change (buildQuery),
  // not on page/sort change, so paging no longer re-counts 29k rows every click.
  // Kept exact: it drives pagination and "select all N matching".
  useEffect(() => {
    let cancelled = false;
    buildQuery(true).then(({ count }) => { if (!cancelled) setTotal(count ?? 0); });
    return () => { cancelled = true; };
  }, [buildQuery, refreshKey]);

  // KPI strip — one RLS-preserving RPC computes all four counts in a single scan
  // (was four separate COUNT(*) queries). `todayStart` is browser-local midnight,
  // passed in so the "today" window matches the user's day, not the DB timezone.
  useEffect(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    let cancelled = false;
    supabase.rpc('nw_lead_kpi_counts', { p_today_start: todayStart.toISOString() })
      .then(({ data }) => {
        if (cancelled) return;
        const r = (data as { total: number; today: number; pool: number; converted: number }[] | null)?.[0];
        if (r) setStats({
          total: Number(r.total) || 0,
          today: Number(r.today) || 0,
          pool: Number(r.pool) || 0,
          converted: Number(r.converted) || 0,
        });
      });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeFilterCount = useMemo(() =>
    (['status', 'priority', 'lead_origin', 'owner_employee_id', 'city', 'state', 'product', 'source',
      'min_investment', 'max_investment', 'date_from', 'date_to'] as (keyof LeadListFilters)[])
      .filter(k => filters[k]).length + (filters.include_archived ? 1 : 0),
    [filters]);

  const toggleSel = (id: string) => { setAllMatching(null); setSelected(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  }); };
  const allOnPageSelected = leads.length > 0 && leads.every(l => selected.has(l.id));
  const toggleAll = () => { setAllMatching(null); setSelected(s => {
    const n = new Set(s);
    if (allOnPageSelected) leads.forEach(l => n.delete(l.id));
    else leads.forEach(l => n.add(l.id));
    return n;
  }); };

  // Selection the bulk toolbar acts on: the whole filtered set when "select all
  // matching" is active, otherwise the ticked rows on the current page.
  const selectedLeads = allMatching ?? leads.filter(l => selected.has(l.id));
  const selectionActive = allMatching != null || selected.size > 0;

  const clearSelection = () => { setAllMatching(null); setSelected(new Set()); };

  // Fetch matching leads and select them. `limit` undefined = ALL matching (no
  // cap); otherwise the first N. Fetched in chunks because Supabase caps rows
  // per request, and so huge selections stay responsive.
  const selectMatching = async (limit?: number) => {
    setSelectingAll(true);
    const CHUNK = 1000;
    const target = limit && limit > 0 ? limit : Infinity;
    let all: NWLead[] = [];
    let from = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const to = from + CHUNK - 1;
      const { data } = await buildQuery(false).order(sortField, { ascending: sortDir === 'asc' }).range(from, to);
      const rows = (data as unknown as NWLead[]) || [];
      all = all.concat(rows);
      setSelectCount(all.length);           // live progress
      if (rows.length < CHUNK || all.length >= target) break;
      from += CHUNK;
    }
    if (limit && all.length > limit) all = all.slice(0, limit);
    setAllMatching(all);
    setSelected(new Set(all.map(r => r.id)));
    setSelectingAll(false);
  };

  const scopeTabs: { key: LeadListFilters['scope']; label: string; icon: any; adminOnly?: boolean }[] = [
    { key: 'all', label: 'All Leads', icon: Layers },
    { key: 'assigned', label: 'My Assigned', icon: Users2 },
    { key: 'self_generated', label: 'Self-Generated', icon: Sparkles },
    { key: 'pool', label: 'Admin Pool', icon: Inbox, adminOnly: true },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>Lead Management</p>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Leads</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {isAdmin ? 'Full pipeline visibility across the team' : 'Your assigned & self-generated leads'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {viewToggle}
          {isAdmin && onOpenDuplicates && dupCount > 0 && (
            <button onClick={onOpenDuplicates}
              className="px-3 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 relative"
              style={{ background: 'rgba(251,191,36,0.1)', color: 'rgb(var(--warning-soft-rgb))', border: '1px solid rgba(251,191,36,0.3)' }}>
              <ShieldAlert className="w-4 h-4" /> Duplicates
              <span className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center" style={{ background: 'rgb(var(--warning-soft-rgb))', color: '#000' }}>{dupCount}</span>
            </button>
          )}
          {isAdmin && (
            <button onClick={exportFiltered} disabled={exporting}
              className="px-3 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              <Download className="w-4 h-4" /> {exporting ? 'Exporting…' : 'Export'}
            </button>
          )}
          {isAdmin && onImport && (
            <button onClick={onImport}
              className="px-3 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              <Upload className="w-4 h-4" /> Import
            </button>
          )}
          <button onClick={onNew}
            className="px-4 py-2.5 rounded-xl text-sm font-bold text-on-accent flex items-center gap-2"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
            <Plus className="w-4 h-4" /> New Lead
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Active Leads', value: stats.total },
          { label: "Today's Leads", value: stats.today },
          ...(isAdmin ? [{ label: 'In Admin Pool', value: stats.pool }] : [{ label: 'Converted', value: stats.converted }]),
          { label: isAdmin ? 'Converted' : 'Showing', value: isAdmin ? stats.converted : total },
        ].map(k => (
          <div key={k.label} className="rounded-2xl p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{k.label}</p>
            <p className="text-2xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>{k.value.toLocaleString('en-IN')}</p>
          </div>
        ))}
      </div>

      {/* Scope tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {scopeTabs.filter(t => !t.adminOnly || isAdmin).map(t => {
          const active = filters.scope === t.key;
          return (
            <button key={t.key} onClick={() => setF({ scope: t.key })}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all"
              style={{
                background: active ? 'rgba(var(--accent-rgb),0.12)' : 'var(--bg-elevated)',
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
              }}>
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Search + filter toggle */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
          <Input value={searchInput} onChange={e => setSearchInput(e.target.value)}
            placeholder="Search name, mobile, email, city, lead code…" style={{ paddingLeft: '2.25rem' }} />
        </div>
        {/* Saved views */}
        <div className="relative">
          <button onClick={() => setShowViews(s => !s)}
            className="px-3.5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            <Bookmark className="w-4 h-4" /> Views
          </button>
          {showViews && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowViews(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-xl shadow-2xl p-2" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                <p className="text-[10px] font-bold uppercase tracking-wider px-2 py-1" style={{ color: 'var(--text-faint)' }}>Saved views</p>
                {views.length === 0 ? (
                  <p className="text-xs px-2 py-2" style={{ color: 'var(--text-faint)' }}>No saved views yet.</p>
                ) : views.map(v => (
                  <div key={v.id} className="flex items-center gap-1 group">
                    <button onClick={() => applyView(v)} className="flex-1 text-left px-2 py-1.5 text-xs rounded hover:bg-[var(--hover-bg)] truncate" style={{ color: 'var(--text-secondary)' }}>
                      {v.name}{v.is_shared && <span className="ml-1 text-[9px]" style={{ color: 'var(--accent)' }}>· shared</span>}
                    </button>
                    {v.employee_id === employee.id && (
                      <button onClick={() => deleteView(v.id)} className="p-1 rounded" style={{ color: 'var(--text-faint)' }}><X className="w-3 h-3" /></button>
                    )}
                  </div>
                ))}
                <div className="flex items-center gap-1 mt-1 pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <Input value={saveViewName} onChange={e => setSaveViewName(e.target.value)} placeholder="Save current as…" style={{ padding: '0.4rem 0.6rem', fontSize: '0.75rem' }} />
                  <button onClick={saveView} disabled={!saveViewName.trim()} className="p-2 rounded-lg disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}><Save className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            </>
          )}
        </div>
        <button onClick={() => setShowFilters(s => !s)}
          className="px-3.5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 relative"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
          <SlidersHorizontal className="w-4 h-4" /> Filters
          {activeFilterCount > 0 && (
            <span className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center text-on-accent" style={{ background: 'var(--accent)' }}>{activeFilterCount}</span>
          )}
        </button>
        <button onClick={load} className="p-2.5 rounded-xl" title="Refresh"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Advanced filters */}
      {showFilters && (
        <div className="rounded-2xl p-4 space-y-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <FilterSelect label="Status" value={filters.status} onChange={v => setF({ status: v as LeadStatus | '' })}
              options={LEAD_STATUSES.map(s => ({ value: s.label, label: s.label }))} />
            <FilterSelect label="Priority" value={filters.priority} onChange={v => setF({ priority: v as LeadPriority | '' })}
              options={PRIORITIES.map(p => ({ value: p.value, label: p.label }))} />
            <FilterSelect label="Origin" value={filters.lead_origin} onChange={v => setF({ lead_origin: v as LeadOrigin | '' })}
              options={(Object.keys(LEAD_ORIGIN_LABEL) as LeadOrigin[]).map(o => ({ value: o, label: LEAD_ORIGIN_LABEL[o] }))} />
            {isAdmin && (
              <FilterSelect label="Owner" value={filters.owner_employee_id} onChange={v => setF({ owner_employee_id: v })}
                options={employees.map(e => ({ value: e.id, label: e.full_name }))} />
            )}
            <FilterSelect label="Product" value={filters.product} onChange={v => setF({ product: v })}
              options={INTERESTED_PRODUCTS.map(p => ({ value: p, label: p }))} />
            <FilterSelect label="Source" value={filters.source} onChange={v => setF({ source: v })}
              options={LEAD_SOURCES.map(s => ({ value: s, label: s }))} />
            <FilterSelect label="State" value={filters.state} onChange={v => setF({ state: v })}
              options={INDIAN_STATES.map(s => ({ value: s, label: s }))} />
            <div>
              <FilterLabel>City</FilterLabel>
              <Input value={filters.city} onChange={e => setF({ city: e.target.value })} placeholder="City" />
            </div>
            <div>
              <FilterLabel>Min Investment</FilterLabel>
              <Input type="number" value={filters.min_investment} onChange={e => setF({ min_investment: e.target.value })} placeholder="₹" />
            </div>
            <div>
              <FilterLabel>Max Investment</FilterLabel>
              <Input type="number" value={filters.max_investment} onChange={e => setF({ max_investment: e.target.value })} placeholder="₹" />
            </div>
            <div>
              <FilterLabel>From Date</FilterLabel>
              <Input type="date" value={filters.date_from} onChange={e => setF({ date_from: e.target.value })} />
            </div>
            <div>
              <FilterLabel>To Date</FilterLabel>
              <Input type="date" value={filters.date_to} onChange={e => setF({ date_to: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 self-end pb-2.5 cursor-pointer">
              <input type="checkbox" checked={filters.include_archived} onChange={e => setF({ include_archived: e.target.checked })} />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Include archived</span>
            </label>
          </div>
          <div className="flex justify-end">
            <button onClick={() => { setFilters(EMPTY_FILTERS); setSearchInput(''); setPage(0); }}
              className="text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--accent)' }}>
              <X className="w-3.5 h-3.5" /> Clear all filters
            </button>
          </div>
        </div>
      )}

      {/* Bulk action bar (admin) */}
      {isAdmin && selectionActive && (
        <div className="space-y-2">
          <LeadBulkToolbar
            employee={employee}
            leads={selectedLeads}
            onAssign={onAssign}
            onDone={load}
            onClear={clearSelection}
          />
          {/* Select-all-matching affordance */}
          {(allMatching != null || selectingAll || (allOnPageSelected && total > leads.length)) && (
            <div className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs flex-wrap" style={{ background: 'var(--bg-elevated)', border: '1px dashed var(--border)' }}>
              {selectingAll ? (
                <span className="flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Selecting… {selectCount.toLocaleString('en-IN')}
                </span>
              ) : allMatching != null ? (
                <>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    <strong style={{ color: 'var(--accent)' }}>{allMatching.length.toLocaleString('en-IN')}</strong> lead{allMatching.length === 1 ? '' : 's'} selected across all pages.
                  </span>
                  <button onClick={clearSelection} className="font-semibold" style={{ color: 'var(--accent)' }}>Clear selection</button>
                </>
              ) : (
                <>
                  <span style={{ color: 'var(--text-secondary)' }}>All {leads.length} on this page selected.</span>
                  <button onClick={() => selectMatching()} className="font-semibold" style={{ color: 'var(--accent)' }}>
                    Select all {total.toLocaleString('en-IN')} matching
                  </button>
                  <span style={{ color: 'var(--text-faint)' }}>·</span>
                  <span className="flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                    Select first
                    <input type="number" min={1} max={total} value={nInput}
                      onChange={e => setNInput(e.target.value.replace(/\D/g, ''))}
                      onKeyDown={e => { if (e.key === 'Enter' && nInput) selectMatching(Math.min(Number(nInput), total)); }}
                      placeholder={String(Math.min(100, total))}
                      className="w-20 px-2 py-1 rounded-lg text-xs outline-none"
                      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
                    <button onClick={() => nInput && selectMatching(Math.min(Number(nInput), total))}
                      disabled={!nInput || Number(nInput) < 1}
                      className="font-semibold px-2 py-1 rounded-lg disabled:opacity-40"
                      style={{ background: 'rgba(var(--accent-rgb),0.1)', color: 'var(--accent)' }}>Go</button>
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {isAdmin && (
                  <th className="w-10 px-3 py-3">
                    <input type="checkbox" checked={allMatching != null || allOnPageSelected} onChange={toggleAll} title="Select all on this page" />
                  </th>
                )}
                {COLUMNS.map((c, i) => {
                  const active = c.field && sortField === c.field;
                  return (
                    <th key={i} className="px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: active ? 'var(--accent)' : 'var(--text-faint)' }}>
                      {c.field ? (
                        <button onClick={() => toggleSort(c.field!)} className="inline-flex items-center gap-1 hover:opacity-80" title={`Sort by ${c.label}`}>
                          {c.label}
                          {active ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
                                  : <ChevronsUpDown className="w-3 h-3 opacity-40" />}
                        </button>
                      ) : c.label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={isAdmin ? 11 : 10} className="text-center py-12">
                  <LogoLoader size={40} />
                </td></tr>
              ) : leads.length === 0 ? (
                <tr><td colSpan={isAdmin ? 11 : 10} className="text-center py-14">
                  <Inbox className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-faint)' }} />
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No leads found</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>Try adjusting filters, or create a new lead.</p>
                </td></tr>
              ) : leads.map(l => (
                <tr key={l.id} className="transition-colors hover:bg-[var(--hover-bg)]" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {isAdmin && (
                    <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleSel(l.id)} />
                    </td>
                  )}
                  <td className="px-3 py-3 cursor-pointer" onClick={() => onOpen(l)}>
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-bold flex-shrink-0"
                        style={{ background: 'rgba(var(--accent-rgb),0.1)', color: 'var(--accent)' }}>
                        {initials(l.lead_name)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold truncate max-w-[180px]" style={{ color: 'var(--text-primary)' }}>{l.lead_name}</p>
                        <p className="text-[11px] font-mono" style={{ color: 'var(--accent)' }}>{l.lead_code}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <p className="text-xs" style={{ color: 'var(--text-primary)' }}>{l.mobile || '—'}</p>
                    <p className="text-[11px] truncate max-w-[160px]" style={{ color: 'var(--text-faint)' }}>{l.email || '—'}</p>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <p className="text-xs" style={{ color: 'var(--text-primary)' }}>{l.city || '—'}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{l.state || '—'}</p>
                  </td>
                  <td className="px-3 py-3"><StatusBadge status={l.status} small /></td>
                  <td className="px-3 py-3"><PriorityBadge priority={l.priority} /></td>
                  <td className="px-3 py-3"><ScoreBadge score={l.lead_score} band={l.score_band} /></td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {l.owner ? <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{l.owner.full_name}</span>
                      : <span className="text-[11px] px-2 py-0.5 rounded" style={{ background: 'rgba(168,85,247,0.12)', color: 'rgb(168,85,247)' }}>Admin Pool</span>}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{formatMoney(l.investment_capacity)}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{formatDate(l.created_at)}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{relativeTime(l.created_at)}</p>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <button onClick={() => onEdit(l)} className="p-1.5 rounded-lg" title="Edit"
                        style={{ color: 'var(--text-faint)' }}><Pencil className="w-3.5 h-3.5" /></button>
                      {isAdmin && (
                        <button onClick={() => onAssign([l])} className="p-1.5 rounded-lg" title="Assign"
                          style={{ color: 'var(--text-faint)' }}><UserPlus className="w-3.5 h-3.5" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--border)' }}>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString('en-IN')}
            </p>
            <div className="flex items-center gap-1">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                className="p-1.5 rounded-lg disabled:opacity-30" style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs px-2" style={{ color: 'var(--text-secondary)' }}>{page + 1} / {totalPages}</span>
              <button disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}
                className="p-1.5 rounded-lg disabled:opacity-30" style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-faint)' }}>{children}</label>;
}

function FilterSelect({ label, value, onChange, options }:
  { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div>
      <FilterLabel>{label}</FilterLabel>
      <Select value={value} onChange={e => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
    </div>
  );
}
