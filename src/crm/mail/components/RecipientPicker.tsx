// Pick who gets the campaign: everyone in scope, or hand-picked people.
//
// "Scope" is decided by the database, not here: mail_audience_members returns
// every client / partner for an admin and only the employee's own book for
// anyone else, and the send path re-applies the same restriction. The picker
// just stores the chosen ids in filters.ids.

import { useMemo, useState } from 'react';
import { CheckSquare, Search, Square } from 'lucide-react';
import { Input } from '../../ui/kit';
import { useAudienceMembers } from '../mailClient';
import type { CampaignFilters, MailAudience } from '../mailTypes';

interface Props {
  audience: MailAudience;
  filters: CampaignFilters;
  onChange: (f: CampaignFilters) => void;
  disabled?: boolean;
  /** Employee authors see "my clients"; admins see "all clients". */
  ownBookOnly: boolean;
}

export default function RecipientPicker({ audience, filters, onChange, disabled, ownBookOnly }: Props) {
  const selectedMode = Array.isArray(filters.ids);
  const members = useAudienceMembers(audience, selectedMode);
  const [q, setQ] = useState('');
  const picked = useMemo(() => new Set(filters.ids ?? []), [filters.ids]);

  const noun = audience === 'client' ? 'clients' : 'partners';
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = members.data ?? [];
    return s
      ? list.filter((m) => m.full_name.toLowerCase().includes(s) || (m.code ?? '').toLowerCase().includes(s) || m.email.includes(s))
      : list;
  }, [members.data, q]);

  const setIds = (ids: string[]) => onChange({ ...filters, ids });
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setIds([...next]);
  };

  const radio = (on: boolean, label: string, onClick: () => void) => (
    <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text)' }}>
      <input type="radio" checked={on} disabled={disabled} onChange={onClick} />
      {label}
    </label>
  );

  return (
    <div className="space-y-2">
      {radio(!selectedMode, `All ${ownBookOnly ? 'my ' : ''}${noun}`, () => {
        const rest = { ...filters };
        delete rest.ids;
        onChange(rest);
      })}
      {radio(selectedMode, `Selected ${noun}`, () => setIds(filters.ids ?? []))}

      {selectedMode && (
        <div className="rounded-lg p-2 space-y-2" style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${noun}`}
              style={{ paddingLeft: 28 }} />
          </div>
          <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
            <span>{picked.size} selected</span>
            {!disabled && (
              <span className="flex gap-3">
                <button type="button" className="underline"
                  onClick={() => setIds([...new Set([...picked, ...shown.filter((m) => !m.suppressed).map((m) => m.id)])])}>
                  Select {q ? 'shown' : 'all'}
                </button>
                <button type="button" className="underline" onClick={() => setIds([])}>Clear</button>
              </span>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto space-y-0.5">
            {members.isLoading && <p className="text-xs py-2" style={{ color: 'var(--text-muted)' }}>Loading…</p>}
            {!members.isLoading && shown.length === 0 && (
              <p className="text-xs py-2" style={{ color: 'var(--text-muted)' }}>No {noun} with an email address.</p>
            )}
            {shown.map((m) => {
              const on = picked.has(m.id);
              return (
                <button key={m.id} type="button" disabled={disabled || m.suppressed}
                  onClick={() => toggle(m.id)}
                  className="w-full flex items-start gap-2 text-left px-2 py-1.5 rounded-md disabled:opacity-50"
                  style={{ background: on ? 'rgba(var(--accent-rgb),0.08)' : 'transparent' }}>
                  {on ? <CheckSquare size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
                      : <Square size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--text-muted)' }} />}
                  <span className="min-w-0">
                    <span className="block text-sm truncate" style={{ color: 'var(--text)' }}>{m.full_name}</span>
                    <span className="block text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                      {m.code ? `${m.code} · ` : ''}{m.email}{m.suppressed ? ' · unsubscribed' : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
