import { useState, type FormEvent } from 'react';
import { CheckCircle2, LifeBuoy, X } from 'lucide-react';
import { SupportService, type NewTicketInput, type TicketCategory } from '../../services/SupportService';

interface RaiseTicketModalProps {
  clientId: string;
  onClose: () => void;
  /** Called after a ticket is created so parents can refresh their list. */
  onCreated?: () => void;
}

const CATEGORIES: Array<{ value: TicketCategory; label: string }> = [
  { value: 'general', label: 'General enquiry' },
  { value: 'transaction', label: 'Transaction / order' },
  { value: 'kyc', label: 'KYC / verification' },
  { value: 'bank', label: 'Bank account' },
  { value: 'technical', label: 'Technical / login' },
  { value: 'feedback', label: 'Feedback' },
];

/**
 * Client-facing "Raise a Ticket" form. Persists to nw_support_tickets via
 * SupportService; on success shows the ticket reference the client can quote.
 */
export function RaiseTicketModal({ clientId, onClose, onCreated }: RaiseTicketModalProps) {
  const [form, setForm] = useState<NewTicketInput>({ category: 'general', subject: '', message: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdRef, setCreatedRef] = useState<string | null>(null);

  const canSubmit = form.subject.trim().length > 0 && form.message.trim().length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!canSubmit) return;
    setLoading(true);
    try {
      const ticket = await SupportService.createTicket(clientId, form);
      setCreatedRef(ticket.ref);
      onCreated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not raise your ticket. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay p-4">
      <div className="w-full max-w-md overflow-hidden rounded-token-xl border border-border bg-modal shadow-token-lg">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <LifeBuoy className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-bold text-text-primary">Raise a Ticket</h3>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X className="h-5 w-5" />
          </button>
        </div>

        {createdRef ? (
          <div className="space-y-4 p-6 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-success" />
            <div>
              <p className="text-sm font-bold text-text-primary">Ticket raised</p>
              <p className="mt-1 text-xs text-text-secondary">
                Your relationship team has been notified and will get back to you soon.
              </p>
            </div>
            <div className="rounded-token-md border border-border bg-bg-base px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-text-faint">Reference</p>
              <p className="font-mono text-sm font-bold text-text-primary">{createdRef}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-token-md px-5 py-2.5 text-sm font-bold text-on-accent"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 p-6">
            {error && (
              <div className="rounded-token-md border border-danger-soft/20 bg-danger-soft/10 p-3 text-xs text-danger-soft">
                {error}
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">
                Category
              </label>
              <select
                value={form.category}
                onChange={(e) => setForm((p) => ({ ...p, category: e.target.value as TicketCategory }))}
                className="w-full rounded-token-md border border-border bg-bg-base px-3.5 py-2.5 text-sm text-text-primary outline-none transition-colors focus:border-accent"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">
                Subject
              </label>
              <input
                type="text"
                value={form.subject}
                maxLength={160}
                onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))}
                placeholder="Brief summary of your issue"
                required
                className="w-full rounded-token-md border border-border bg-bg-base px-3.5 py-2.5 text-sm text-text-primary outline-none transition-colors focus:border-accent"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">
                Message
              </label>
              <textarea
                value={form.message}
                maxLength={4000}
                rows={4}
                onChange={(e) => setForm((p) => ({ ...p, message: e.target.value }))}
                placeholder="Tell us what you need help with…"
                required
                className="w-full resize-none rounded-token-md border border-border bg-bg-base px-3.5 py-2.5 text-sm text-text-primary outline-none transition-colors focus:border-accent"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-token-md border border-border bg-bg-raised px-4 py-2 text-sm text-text-muted"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !canSubmit}
                className="rounded-token-md px-5 py-2.5 text-sm font-bold text-on-accent disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
              >
                {loading ? 'Submitting…' : 'Submit Ticket'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
