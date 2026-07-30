/**
 * Reports — export what BSE holds, as CSV.
 *
 * Deliberately exports the same rows the console displays, straight from BSE,
 * so a spreadsheet and the screen can never disagree. There is no revenue or
 * AUM report here: BSE returns errcode `authz` for get_mis_detail and the
 * payment-detail APIs on our member tier, so we have no settled figures to
 * report and will not manufacture them.
 */
import { useState } from 'react';
import { Download, FileText, Info } from 'lucide-react';
import { Card } from '../../../portal/components/Card';
import { SectionHeader } from '../../../portal/components/SectionHeader';
import { BseOpsService, isBseConfigured } from '../../services/BseOpsService';
import { ErrorNote, NotConfigured } from './formBits';

/** RFC4180-ish escaping — commas, quotes and newlines all appear in scheme names. */
function toCsv(rows: Record<string, unknown>[], headers: [string, string][]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = headers.map(([, label]) => esc(label)).join(',');
  const body = rows.map((r) => headers.map(([key]) => esc(r[key])).join(',')).join('\n');
  return `${head}\n${body}`;
}

function download(name: string, csv: string) {
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `niyom-${name}-${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

interface ReportDef {
  key: string;
  title: string;
  description: string;
  run: () => Promise<{ rows: Record<string, unknown>[]; headers: [string, string][] }>;
}

const REPORTS: ReportDef[] = [
  {
    key: 'orders',
    title: 'Order book',
    description: 'Every purchase, redemption and switch placed at BSE, with status and folio.',
    run: async () => ({
      rows: (await BseOpsService.orders()) as unknown as Record<string, unknown>[],
      headers: [
        ['orderId', 'Order ID'],
        ['memberRef', 'Member Ref'],
        ['clientCode', 'UCC'],
        ['clientName', 'Client'],
        ['schemeCode', 'Scheme Code'],
        ['schemeName', 'Scheme'],
        ['type', 'Type'],
        ['amount', 'Amount'],
        ['folio', 'Folio'],
        ['status', 'Status'],
        ['placedAt', 'Placed At'],
        ['rejectionReason', 'Rejection Reason'],
      ],
    }),
  },
  {
    key: 'clients',
    title: 'UCC register',
    description: 'All client codes registered under the member, with verification status.',
    run: async () => ({
      rows: (await BseOpsService.uccs()) as unknown as Record<string, unknown>[],
      headers: [
        ['clientCode', 'UCC'],
        ['name', 'Name'],
        ['pan', 'PAN'],
        ['holdingNature', 'Holding'],
        ['isPanVerified', 'PAN Verified'],
        ['isPanExempt', 'PAN Exempt'],
        ['status', 'Status'],
      ],
    }),
  },
  {
    key: 'sip',
    title: 'Systematic plans',
    description: 'SIP, STP and SWP registrations with frequency, amount and state.',
    run: async () => ({
      rows: (await BseOpsService.sxp()) as unknown as Record<string, unknown>[],
      headers: [
        ['sxpRegNum', 'Registration'],
        ['clientCode', 'UCC'],
        ['type', 'Type'],
        ['schemeCode', 'Scheme'],
        ['amount', 'Amount'],
        ['frequency', 'Frequency'],
        ['startDate', 'Start Date'],
        ['status', 'Status'],
      ],
    }),
  },
  {
    key: 'holdings',
    title: 'Settled holdings',
    description:
      'Positions netted from allotted orders. Empty until BSE settles — a folio only exists after allotment.',
    run: async () => ({
      rows: (await BseOpsService.holdings()) as unknown as Record<string, unknown>[],
      headers: [
        ['clientCode', 'UCC'],
        ['folio', 'Folio'],
        ['schemeCode', 'Scheme Code'],
        ['schemeName', 'Scheme'],
        ['units', 'Units'],
        ['invested', 'Invested'],
        ['lastNav', 'Last NAV'],
        ['value', 'Value'],
      ],
    }),
  },
];

export function ReportsPage() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastCount, setLastCount] = useState<Record<string, number>>({});

  const run = async (r: ReportDef) => {
    setBusy(r.key);
    setError(null);
    try {
      const { rows, headers } = await r.run();
      if (rows.length === 0) {
        setError(`${r.title} has no rows to export yet.`);
        setLastCount((c) => ({ ...c, [r.key]: 0 }));
        return;
      }
      download(r.key, toCsv(rows, headers));
      setLastCount((c) => ({ ...c, [r.key]: rows.length }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setBusy(null);
    }
  };

  if (!isBseConfigured()) return <NotConfigured title="Reports" />;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {error && <ErrorNote title="Export" message={error} />}

      <Card>
        <SectionHeader title="Export from BSE" icon={FileText} />
        <ul className="divide-y divide-border/60">
          {REPORTS.map((r) => (
            <li key={r.key} className="flex items-start gap-4 py-3.5">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-text-primary">{r.title}</span>
                <span className="mt-0.5 block text-[11px] text-text-secondary">{r.description}</span>
                {lastCount[r.key] !== undefined && (
                  <span className="mt-1 block text-[10px] text-text-faint">
                    {lastCount[r.key] === 0
                      ? 'Nothing to export'
                      : `Exported ${lastCount[r.key]} row${lastCount[r.key] === 1 ? '' : 's'}`}
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => run(r)}
                disabled={busy !== null}
                className="flex shrink-0 items-center gap-1.5 rounded-token-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                {busy === r.key ? 'Preparing…' : 'CSV'}
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <div className="flex items-start gap-2 rounded-token-md border border-border bg-bg-surface p-3 text-xs text-text-secondary">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
        <span>
          Exports are pulled live from BSE at the moment you click, so they always match the
          screens. There is no brokerage or AUM report: BSE does not expose those to this member
          code.
        </span>
      </div>
    </div>
  );
}
