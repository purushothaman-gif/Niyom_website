import { useState, useEffect, useCallback } from 'react';
import { Handshake, Copy, Check, ChevronDown, Link2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { NWEmployee } from './types';

interface RefLink { id: string; employee_id: string | null; ref_code: string; label: string | null; }

/**
 * Partner self-onboarding links, for copy-paste. A partner who signs up via a
 * link is mapped under that employee (or the house account for the company-direct
 * link). Non-admins see only their own link; admins see the company-direct link
 * plus every employee's. Additive: reads mkt_referral_links (kind='partner') and
 * lazily ensures links exist via nw_ensure_partner_ref_links.
 */
export function PartnerOnboardLinks({ employee }: { employee: NWEmployee }) {
  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';
  const [links, setLinks] = useState<RefLink[]>([]);
  const [empNames, setEmpNames] = useState<Map<string, string>>(new Map());
  const [open, setOpen] = useState(!isAdmin); // employees: expanded (one link); admins: collapsed
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Best-effort self-heal so every active employee (incl. new ones) has a link.
    await supabase.rpc('nw_ensure_partner_ref_links').then(() => {}, () => {});
    const { data } = await supabase
      .from('mkt_referral_links')
      .select('id, employee_id, ref_code, label')
      .eq('kind', 'partner')
      .eq('active', true);
    let rows = (data as RefLink[]) || [];
    if (!isAdmin) rows = rows.filter(r => r.employee_id === employee.id);
    // Company-direct first, then by employee name.
    if (isAdmin) {
      const { data: emps } = await supabase.from('nw_employees').select('id, full_name');
      setEmpNames(new Map((emps || []).map((e: any) => [e.id, e.full_name])));
    }
    setLinks(rows);
  }, [isAdmin, employee.id]);
  useEffect(() => { load(); }, [load]);

  const urlFor = (code: string) => `${window.location.origin}/partner-onboarding?ref=${code}`;
  const copy = async (code: string) => {
    try { await navigator.clipboard.writeText(urlFor(code)); } catch { /* clipboard blocked */ }
    setCopied(code);
    setTimeout(() => setCopied(c => (c === code ? null : c)), 1600);
  };

  const nameFor = (l: RefLink) =>
    l.employee_id ? (empNames.get(l.employee_id) || l.label || 'Employee') : 'Company Direct';

  const sorted = [...links].sort((a, b) => {
    if (!a.employee_id) return -1; // company first
    if (!b.employee_id) return 1;
    return nameFor(a).localeCompare(nameFor(b));
  });

  if (!sorted.length) return null;

  const Row = ({ l }: { l: RefLink }) => (
    <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold" style={{ color: l.employee_id ? 'var(--text-primary)' : 'var(--accent)' }}>
          {nameFor(l)}{!l.employee_id && ' (house account)'}
        </p>
        <p className="text-xs font-mono truncate" style={{ color: 'var(--text-muted)' }}>{urlFor(l.ref_code)}</p>
      </div>
      <button onClick={() => copy(l.ref_code)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0"
        style={{ background: copied === l.ref_code ? 'rgba(16,185,129,0.12)' : 'rgba(var(--accent-rgb),0.1)', color: copied === l.ref_code ? 'var(--success)' : 'var(--accent)', border: `1px solid ${copied === l.ref_code ? 'var(--success)' : 'rgba(var(--accent-rgb),0.25)'}` }}>
        {copied === l.ref_code ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy</>}
      </button>
    </div>
  );

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
      <button onClick={() => setOpen(o => !o)} className="w-full px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(var(--accent-rgb),0.1)', border: '1px solid rgba(var(--accent-rgb),0.2)' }}>
            <Handshake className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          </div>
          <div className="text-left">
            <p className="text-sm font-bold text-text-primary">Partner Onboarding Links</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {isAdmin ? 'Share a link so partners self-register — mapped under that employee.' : 'Share this link — partners who sign up through it are mapped under you.'}
            </p>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--text-faint)' }} />
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-2.5">
          {sorted.map(l => <Row key={l.id} l={l} />)}
          <p className="text-xs flex items-center gap-1.5 pt-1" style={{ color: 'var(--text-faint)' }}>
            <Link2 className="w-3.5 h-3.5" /> Partners set their own password and finish KYC (bank, ARN) in the portal after signing up.
          </p>
        </div>
      )}
    </div>
  );
}
