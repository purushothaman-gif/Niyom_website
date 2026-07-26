import { useState } from 'react';
import { Download, FileText, FolderClosed, Loader2 } from 'lucide-react';
import { fmtDate } from '../../../crm/utils';
import { LogoLoader } from '../../../components/LogoLoader';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { StatusPill } from '../../components/StatusPill';
import { useDocuments } from '../../hooks/useDocuments';
import { DocumentService } from '../../services/DocumentService';
import type { ClientDocument } from '../../types/activity';

const fmtSize = (bytes: number): string => {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

function DocumentRow({ doc }: { doc: ClientDocument }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  const open = async () => {
    setBusy(true);
    setErr(false);
    try {
      const url = await DocumentService.getSignedUrl(doc.filePath);
      window.open(url, '_blank', 'noopener');
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-token-md bg-accent/10">
        <FileText className="h-4 w-4 text-accent" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-text-primary">{doc.fileName}</p>
        <p className="text-[11px] text-text-secondary">
          {fmtDate(doc.uploadedAt)} · {fmtSize(doc.fileSize)}
          {err && <span className="ml-1.5 text-danger-soft">· link failed, retry</span>}
        </p>
      </div>
      <StatusPill tone="muted">{doc.docTypeLabel}</StatusPill>
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className="flex h-8 w-8 items-center justify-center rounded-token-md border border-border bg-bg-surface text-text-muted transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50"
        title="Download"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      </button>
    </li>
  );
}

export function DocumentsPage({ clientId }: { clientId: string }) {
  const { documents, loading, error } = useDocuments(clientId);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LogoLoader size={48} />
      </div>
    );
  }

  if (error) return <Card><EmptyState icon={FolderClosed} title={error} /></Card>;

  if (documents.length === 0) {
    return <Card><EmptyState icon={FolderClosed} title="No documents yet." hint="Statements and KYC documents shared by your advisor will appear here." /></Card>;
  }

  return (
    <div className="space-y-3">
      <p className="px-1 text-sm text-text-secondary">
        <span className="font-bold text-text-primary">{documents.length}</span> documents
      </p>
      <Card padding="none" className="overflow-hidden">
        <ul className="divide-y divide-border-subtle">
          {documents.map((d) => (
            <DocumentRow key={d.id} doc={d} />
          ))}
        </ul>
      </Card>
    </div>
  );
}
