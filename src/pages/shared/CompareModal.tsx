import { useEffect } from 'react';
import { X, Wallet } from 'lucide-react';
import type { MutualFund } from './mfSource';
import { fmtPct, returnColor, fmtNav, RiskBadge } from './mfFormat';

/**
 * Side-by-side comparison of the pinned funds. Uses the metrics already loaded
 * into the curated `MutualFund` rows — no extra fetch — so it opens instantly.
 */

const ROWS: { label: string; render: (f: MutualFund) => React.ReactNode }[] = [
  { label: 'Category', render: (f) => <span className="text-text-secondary">{f.category}{f.sub_category ? ` · ${f.sub_category}` : ''}</span> },
  { label: 'Fund house', render: (f) => <span className="text-text-secondary">{f.fund_house ?? '—'}</span> },
  { label: 'Risk', render: (f) => <RiskBadge level={f.risk_level} /> },
  { label: 'Current NAV', render: (f) => <span className="text-text-primary font-medium">{fmtNav(f.current_nav)}</span> },
  { label: 'YTD', render: (f) => <span style={{ color: returnColor(f.return_ytd) }} className="font-semibold">{fmtPct(f.return_ytd)}</span> },
  { label: '1Y', render: (f) => <span style={{ color: returnColor(f.return_1y) }} className="font-semibold">{fmtPct(f.return_1y)}</span> },
  { label: '3Y p.a.', render: (f) => <span style={{ color: returnColor(f.return_3y) }} className="font-semibold">{fmtPct(f.return_3y)}</span> },
  { label: '5Y p.a.', render: (f) => <span style={{ color: returnColor(f.return_5y) }} className="font-semibold">{fmtPct(f.return_5y)}</span> },
  { label: 'Since incep. p.a.', render: (f) => <span style={{ color: returnColor(f.return_si) }} className="font-semibold">{fmtPct(f.return_si)}</span> },
  { label: 'Min. investment', render: (f) => <span className="text-text-secondary">{fmtNav(f.min_investment)}</span> },
];

interface CompareModalProps {
  funds: MutualFund[];
  onClose: () => void;
  onRemove: (id: string) => void;
}

export function CompareModal({ funds, onClose, onRemove }: CompareModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Compare funds"
    >
      <div
        className="w-full sm:max-w-3xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 sm:px-6 py-4"
          style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)' }}
        >
          <h2 className="font-bold text-text-primary" style={{ fontFamily: 'var(--font-display)' }}>
            Compare funds
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.open('/onboarding', '_blank')}
              className="lift press inline-flex items-center gap-2 bg-accent-soft hover:bg-accent-soft-deep text-black font-semibold px-4 py-2 rounded-lg shadow-md text-sm"
            >
              <Wallet size={15} /> Invest Now
            </button>
            <button
              onClick={onClose}
              aria-label="Close"
              className="press p-1.5 rounded-lg"
              style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)' }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <th className="px-4 py-3 text-left text-text-muted font-semibold sticky left-0" style={{ background: 'var(--bg-elevated)' }}></th>
                {funds.map((f) => (
                  <th key={f.id} className="px-4 py-3 text-left align-top min-w-[160px]">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-text-primary leading-snug">{f.fund_name}</span>
                      <button
                        onClick={() => onRemove(f.id)}
                        aria-label={`Remove ${f.fund_name}`}
                        className="press flex-shrink-0 p-1 rounded-md"
                        style={{ background: 'var(--bg-raised)', color: 'var(--text-muted)' }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.label} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td className="px-4 py-2.5 text-text-muted font-medium whitespace-nowrap sticky left-0" style={{ background: 'var(--bg-elevated)' }}>
                    {row.label}
                  </td>
                  {funds.map((f) => (
                    <td key={f.id} className="px-4 py-2.5">{row.render(f)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="px-5 sm:px-6 py-4 text-[11px] text-text-faint leading-relaxed">
          Returns over 1 year are annualised (CAGR). Past performance is not indicative of future
          returns.
        </p>
      </div>
    </div>
  );
}
