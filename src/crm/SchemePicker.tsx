import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * Pick the exact scheme a mutual fund holding is in.
 *
 * ## Why a picker and not a text field
 *
 * A fund's name does not identify it. "SBI Multi Asset Allocation Fund" matches
 * fourteen schemes whose NAVs run from 29.79 to 74.54 — Direct against Regular,
 * Growth against monthly, quarterly and annual IDCW. Priced off the wrong one, a
 * client's holding is out by up to two and a half times, and nothing on the
 * screen would look wrong.
 *
 * So staff choose from what AMFI actually publishes, and we store the ISIN. The
 * rule that follows is simple: if it can be picked here, it can be priced every
 * night, forever.
 *
 * ## Why nav_daily is the catalogue
 *
 * It is the same table the pricing reads. Picking from anything else would let
 * staff choose a scheme we then cannot price — a catalogue and a price feed that
 * disagree is a bug waiting for a client to find.
 */
export interface SchemeChoice {
  isin: string;
  schemeName: string;
  nav: number;
  navDate: string;
}

export function SchemePicker({
  value,
  onSelect,
  onClear,
}: {
  /** The currently chosen ISIN, if any. */
  value?: string | null;
  onSelect: (choice: SchemeChoice) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SchemeChoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<SchemeChoice | null>(null);
  const box = useRef<HTMLDivElement>(null);

  /* Show what is already stored, so an edit does not look unset. */
  useEffect(() => {
    if (!value) {
      setChosen(null);
      return;
    }
    let alive = true;
    void supabase
      .from('nav_daily')
      .select('isin,scheme_name,nav,nav_date')
      .eq('isin', value)
      .order('nav_date', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive || !data) return;
        setChosen({
          isin: data.isin as string,
          schemeName: data.scheme_name as string,
          nav: Number(data.nav),
          navDate: data.nav_date as string,
        });
      });
    return () => {
      alive = false;
    };
  }, [value]);

  /* Debounced: this fires on every keystroke against 17,000 rows. */
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('nav_daily')
        .select('isin,scheme_name,nav,nav_date')
        .ilike('scheme_name', `%${q}%`)
        .order('nav_date', { ascending: false })
        .limit(60);
      /*
       * One scheme is published under two ISINs (payout and reinvestment) at the
       * same NAV, and every scheme appears once per day held. Collapse to the
       * newest row per ISIN so the list reads as schemes rather than rows.
       */
      const seen = new Set<string>();
      const rows: SchemeChoice[] = [];
      for (const r of data ?? []) {
        const isin = r.isin as string;
        if (seen.has(isin)) continue;
        seen.add(isin);
        rows.push({
          isin,
          schemeName: r.scheme_name as string,
          nav: Number(r.nav),
          navDate: r.nav_date as string,
        });
      }
      setResults(rows.slice(0, 25));
      setLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const hint = useMemo(
    () =>
      query.trim().length > 0 && query.trim().length < 3
        ? 'Keep typing — at least three characters.'
        : null,
    [query],
  );

  if (chosen) {
    return (
      <div
        className="flex items-start gap-2 rounded-xl px-3 py-2.5"
        style={{ background: 'var(--bg-base)', border: '1px solid var(--success-soft, var(--border))' }}
      >
        <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--success)' }} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-primary">{chosen.schemeName}</p>
          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
            {chosen.isin} · NAV ₹{chosen.nav} on {chosen.navDate}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setChosen(null);
            setQuery('');
            onClear();
          }}
          className="shrink-0"
          style={{ color: 'var(--text-faint)' }}
          aria-label="Choose a different scheme"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div ref={box} className="relative">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
          style={{ color: 'var(--text-faint)' }}
        />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search the scheme by name, e.g. SBI Multi Asset"
          className="w-full rounded-xl py-2.5 pl-9 pr-3 text-sm outline-none"
          style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
        />
      </div>

      {hint && <p className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>{hint}</p>}

      {open && (loading || results.length > 0) && (
        <div
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl shadow-lg"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        >
          {loading && (
            <p className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-faint)' }}>Searching…</p>
          )}
          {!loading &&
            results.map((r) => (
              <button
                key={r.isin}
                type="button"
                onClick={() => {
                  setChosen(r);
                  setOpen(false);
                  onSelect(r);
                }}
                className="block w-full px-3 py-2.5 text-left hover:opacity-80"
                style={{ borderBottom: '1px solid var(--bg-raised)' }}
              >
                <p className="text-sm text-text-primary">{r.schemeName}</p>
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  {r.isin} · NAV ₹{r.nav} on {r.navDate}
                </p>
              </button>
            ))}
        </div>
      )}

      {open && !loading && query.trim().length >= 3 && results.length === 0 && (
        <div
          className="absolute z-20 mt-1 w-full rounded-xl px-3 py-2.5"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        >
          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
            No scheme matched. Only funds AMFI publishes a NAV for can be priced automatically —
            leave this blank and enter the value by hand if it is not listed.
          </p>
        </div>
      )}
    </div>
  );
}
