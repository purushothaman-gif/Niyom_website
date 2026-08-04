import { useState } from 'react';
import { AlertTriangle, FileText, Loader2, Trash2 } from 'lucide-react';
import { fmtDate, fmtFull } from '../../../crm/utils';
import { CasImportService, type CasImportRecord } from '../../services/CasImportService';

interface Props {
  statements: CasImportRecord[];
  /** Re-read the list and the portfolio after a removal. */
  onChanged: () => void;
}

/**
 * The statements currently making up the portfolio, and a way to take one out.
 *
 * This exists because statements now COMBINE. Before, a wrong file was fixed by
 * uploading the right one; now it sits alongside, quietly contributing folios
 * that are not the client's — so there has to be a way to say "not that one".
 *
 * Removal asks first, and says what it costs: the statement file itself was
 * never stored, so putting it back means uploading their copy again.
 */
export function ImportedStatements({ statements, onChanged }: Props) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const live = statements.filter((s) => s.status === 'reconciled');
  if (live.length === 0) return null;

  const remove = async (id: string) => {
    setBusy(id);
    setError('');
    const r = await CasImportService.removeImport(id);
    setBusy(null);
    setConfirming(null);
    if (!r.ok) return setError(r.error);
    onChanged();
  };

  return (
    <div className="rounded-token-md border border-border-subtle bg-bg-surface p-3">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-text-faint">
        {live.length === 1 ? 'Statement in your portfolio' : `${live.length} statements in your portfolio`}
      </p>

      <ul className="space-y-1.5">
        {live.map((s) => (
          <li key={s.id} className="rounded-token-md bg-bg-base px-3 py-2.5">
            <div className="flex items-start gap-2.5">
              <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-secondary" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-text-primary">
                  {s.statement_to ? `Up to ${fmtDate(s.statement_to)}` : 'Statement'}
                  {s.parsed_total ? ` · ${fmtFull(Number(s.parsed_total))}` : ''}
                </p>
                <p className="mt-0.5 text-[11px] text-text-faint">
                  {s.scheme_count ?? 0} scheme{s.scheme_count === 1 ? '' : 's'}
                  {s.transaction_count ? `, ${s.transaction_count} transactions` : ''} · imported{' '}
                  {fmtDate(s.created_at)}
                </p>
              </div>

              {confirming === s.id ? null : (
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(s.id);
                    setError('');
                  }}
                  disabled={busy !== null}
                  className="flex shrink-0 items-center gap-1 rounded-token-md border border-border px-2 py-1 text-[11px] font-semibold text-text-secondary transition-colors hover:text-danger-soft disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" /> Remove
                </button>
              )}
            </div>

            {confirming === s.id && (
              <div className="mt-2.5 rounded-token-md border border-danger-soft/25 bg-danger-soft/5 p-2.5">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger-soft" />
                  <p className="text-[11px] leading-relaxed text-text-secondary">
                    Remove this statement? The holdings and transactions it contributed leave your
                    portfolio.{' '}
                    {live.length === 1
                      ? 'It is the only one you have imported, so your mutual funds will fall back to what we hold for you.'
                      : 'Your other statement stays.'}{' '}
                    We never stored the file, so putting it back means uploading your copy again.
                  </p>
                </div>
                <div className="mt-2.5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    disabled={busy === s.id}
                    className="rounded-token-md border border-border px-2.5 py-1 text-[11px] font-semibold text-text-secondary"
                  >
                    Keep it
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(s.id)}
                    disabled={busy === s.id}
                    className="flex items-center gap-1.5 rounded-token-md bg-danger-soft px-2.5 py-1 text-[11px] font-bold text-bg-elevated disabled:opacity-60"
                  >
                    {busy === s.id && <Loader2 className="h-3 w-3 animate-spin" />}
                    Remove statement
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {error && <p className="mt-2 text-[11px] text-danger-soft">{error}</p>}
    </div>
  );
}
