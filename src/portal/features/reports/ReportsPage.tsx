import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Download,
  FileSpreadsheet,
  FileText,
  Landmark,
  Loader2,
  PiggyBank,
  Receipt,
  ShieldCheck,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { fmt } from '../../../crm/utils';
import type { NWClient, NWHolding } from '../../../crm/types';
import type { HoldingRow } from '../../../../shared/portal/types';
import { Card } from '../../components/Card';
import { KpiStat } from '../../components/KpiStat';
import { ComingSoonBadge } from '../../components/StatusPill';
import { PortfolioService } from '../../services/PortfolioService';
import {
  exportDematHoldingsXlsx,
  exportElssXlsx,
  exportHoldingsXlsx,
  exportTransactionsXlsx,
} from '../../services/exporters';
import { useTransactions } from '../../hooks/useTransactions';
import { mfSsoEnabled } from '../../../../shared/platform/env';

/**
 * ELSS schemes carry an 80C lock-in and need their own statement. A CAS states
 * no scheme category, so match on the name, which reliably carries the ELSS
 * branding ("… ELSS", "… Tax Saver", or the older "… Long Term Equity").
 */
const ELSS_RE = /\b(elss|tax[\s-]?saver|tax[\s-]?saving|long[\s-]?term\s+equity)\b/i;
const isElss = (r: HoldingRow) =>
  r.productType === 'mutual_fund' && (ELSS_RE.test(r.name) || ELSS_RE.test(r.category ?? ''));

interface Props {
  clientId: string;
  client: NWClient | null;
  holdings: NWHolding[];
  /** Capital gains is a screen of its own, not a download — see `open`. */
  onOpenCapitalGains?: () => void;
}

/** Grouped the way a broker's reports screen is: by what the report is for. */
type Category = 'Tax' | 'Holdings' | 'Transactions';

const CATEGORY_ORDER: Category[] = ['Tax', 'Holdings', 'Transactions'];
const CATEGORY_ICON: Record<Category, LucideIcon> = {
  Tax: PiggyBank,
  Holdings: FileSpreadsheet,
  Transactions: Receipt,
};

interface ReportDef {
  key: string;
  category: Category;
  title: string;
  description: string;
  icon: LucideIcon;
  action?: () => Promise<void>;
  /** Navigates rather than downloading. */
  open?: () => void;
  openLabel?: string;
  soon?: boolean;
}

function ReportRow({ report }: { report: ReportDef }) {
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
  // Only offer a report when there is something to put in it.
  const elssRows = useMemo(() => holdingRows.filter(isElss), [holdingRows]);
  const dematRows = useMemo(() => holdingRows.filter((r) => r.demat), [holdingRows]);

  const allReports: ReportDef[] = [
    {
      key: 'capgain',
      category: 'Tax',
      title: 'Capital Gains — Mutual Funds',
      description:
        'Realised gains by financial year, short-term vs long-term, matched FIFO from your imported statement. View on screen or download the Excel.',
      icon: PiggyBank,
      open: onOpenCapitalGains,
      openLabel: 'View capital gains',
    },
    ...(elssRows.length
      ? [
          {
            key: 'elss',
            category: 'Tax' as Category,
            title: 'ELSS Statement (Section 80C)',
            description:
              'Your tax-saving ELSS funds in one sheet — amount invested and current value, as proof for your 80C deduction.',
            icon: ShieldCheck,
            action: () => exportElssXlsx(elssRows, client),
          },
        ]
      : []),
    {
      key: 'holdings',
      category: 'Holdings',
      title: 'Holdings Statement',
      description: 'A snapshot of everything you hold — funds, bonds, shares — with value and P&L.',
      icon: FileSpreadsheet,
      action: () => exportHoldingsXlsx(holdingRows, client),
    },
    ...(dematRows.length
      ? [
          {
            key: 'demat',
            category: 'Holdings' as Category,
            title: 'Demat Holdings',
            description:
              'Shares, bonds and other securities from your imported demat statement — with ISIN and depository, as held.',
            icon: Wallet,
            action: () => exportDematHoldingsXlsx(dematRows, client),
          },
        ]
      : []),
    {
      key: 'txn',
      category: 'Transactions',
      title: 'Transaction Statement',
      description: 'Every buy and sell across all products, as an Excel workbook.',
      icon: Receipt,
      action: () => exportTransactionsXlsx(txnRows, client),
    },
    {
      key: 'cas',
      category: 'Holdings',
      title: 'Consolidated Account Statement',
      description:
        'Issued by CAMS and KFintech, not by us. Request it to your email, then import it here.',
      icon: Landmark,
      soon: true,
    },
  ];

  // The CAS card is only useful when funds are not already on the MF platform.
  const reports = mfSsoEnabled() ? allReports.filter((r) => r.key !== 'cas') : allReports;
  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: reports.filter((r) => r.category === cat),
  })).filter((g) => g.items.length > 0);

  const gainUp = summary.gain >= 0;

  return (
    <div className="space-y-6">
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
        <h2 className="text-sm font-bold text-text-primary">Reports & Statements</h2>
      </div>

      {byCategory.map(({ cat, items }) => {
        const Icon = CATEGORY_ICON[cat];
        return (
          <section key={cat} className="space-y-3">
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-text-muted" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary">{cat}</h3>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {items.map((r) => (
                <ReportRow key={r.key} report={r} />
              ))}
            </div>
          </section>
        );
      })}

      <p className="px-1 text-[11px] text-text-faint">
        Excel statements are generated on your device from your portfolio data — nothing leaves your
        browser. Capital gains are worked out from the Consolidated Account Statement you import, so
        import yours first if the page is empty.
        {mfSsoEnabled() ? ' Your mutual fund order history lives in your mutual fund account.' : ''}
      </p>
    </div>
  );
}
