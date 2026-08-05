import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Download,
  FileSpreadsheet,
  FileText,
  Landmark,
  Loader2,
  Receipt,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { fmt } from '../../../crm/utils';
import type { NWClient, NWHolding } from '../../../crm/types';
import { Card } from '../../components/Card';
import { KpiStat } from '../../components/KpiStat';
import { ComingSoonBadge } from '../../components/StatusPill';
import { PortfolioService } from '../../services/PortfolioService';
import { exportHoldingsXlsx, exportTransactionsXlsx } from '../../services/exporters';
import { useTransactions } from '../../hooks/useTransactions';

interface Props {
  clientId: string;
  client: NWClient | null;
  holdings: NWHolding[];
  /** Capital gains is a screen of its own, not a download — see `open`. */
  onOpenCapitalGains?: () => void;
}

interface ReportDef {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  action?: () => Promise<void>;
  /** Navigates rather than downloading. */
  open?: () => void;
  openLabel?: string;
  soon?: boolean;
}

function ReportCard({ report }: { report: ReportDef }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!report.action) return;
    setBusy(true);
    try {
      await report.action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="md" className="flex items-start gap-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-token-lg bg-accent/10">
        <report.icon className="h-5 w-5 text-accent" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-text-primary">{report.title}</h3>
          {report.soon && <ComingSoonBadge />}
        </div>
        <p className="mt-0.5 text-xs text-text-secondary">{report.description}</p>
        {report.open && (
          <button
            type="button"
            onClick={report.open}
            className="mt-3 inline-flex items-center gap-1.5 rounded-token-md border border-border bg-bg-surface px-3 py-1.5 text-xs font-semibold text-text-primary transition-colors hover:border-accent/40 hover:text-accent"
          >
            <ArrowRight className="h-3.5 w-3.5" />
            {report.openLabel ?? 'Open'}
          </button>
        )}
        {!report.soon && report.action && (
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="mt-3 inline-flex items-center gap-1.5 rounded-token-md border border-border bg-bg-surface px-3 py-1.5 text-xs font-semibold text-text-primary transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {busy ? 'Preparing…' : 'Download Excel'}
          </button>
        )}
      </div>
    </Card>
  );
}

export function ReportsPage({ clientId, client, holdings, onOpenCapitalGains }: Props) {
  const { rows: txnRows } = useTransactions(clientId);
  const summary = useMemo(() => PortfolioService.buildSummary(holdings), [holdings]);
  const holdingRows = useMemo(() => PortfolioService.buildHoldingRows(holdings), [holdings]);

  const reports: ReportDef[] = [
    {
      key: 'txn',
      title: 'Transaction Statement',
      description: 'All buy & sell transactions across products, as an Excel workbook.',
      icon: Receipt,
      action: () => exportTransactionsXlsx(txnRows, client),
    },
    {
      key: 'holdings',
      title: 'Holdings Statement',
      description: 'Current holdings with invested value, market value and P&L.',
      icon: FileSpreadsheet,
      action: () => exportHoldingsXlsx(holdingRows, client),
    },
    {
      key: 'capgain',
      title: 'Capital Gains Statement',
      description:
        'Realised gains by financial year, matched FIFO from your own statement — with the Excel to match.',
      icon: TrendingUp,
      open: onOpenCapitalGains,
      openLabel: 'View capital gains',
    },
    {
      key: 'cas',
      title: 'Consolidated Account Statement',
      description:
        'Issued by CAMS and KFintech, not by us. Request it to your email, then import it here.',
      icon: Landmark,
      soon: true,
    },
  ];

  const gainUp = summary.gain >= 0;

  return (
    <div className="space-y-5">
      <Card padding="lg">
        <div className="grid grid-cols-3 gap-4">
          <KpiStat label="Portfolio Value" value={fmt(summary.netWorth)} color="var(--accent)" />
          <KpiStat label="Invested" value={fmt(summary.invested)} />
          <KpiStat
            label={gainUp ? 'Total Gain' : 'Total Loss'}
            value={`${gainUp ? '+' : ''}${fmt(summary.gain)}`}
            color={gainUp ? 'var(--success)' : 'var(--danger)'}
            sub={`${gainUp ? '+' : ''}${summary.gainPercent.toFixed(2)}%`}
            trend={gainUp ? 'up' : 'down'}
          />
        </div>
      </Card>

      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-bold text-text-primary">Statements & Reports</h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {reports.map((r) => (
          <ReportCard key={r.key} report={r} />
        ))}
      </div>

      <p className="px-1 text-[11px] text-text-faint">
        Excel statements are generated on your device from your portfolio data — nothing leaves your
        browser. A Consolidated Account Statement is issued by the registrars themselves; we cannot
        produce one, but importing yours is what powers everything above.
      </p>
    </div>
  );
}
