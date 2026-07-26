import { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown,
  Headphones,
  Mail,
  MessageSquare,
  Phone,
  Ticket,
  type LucideIcon,
} from 'lucide-react';
import { Card } from '../../components/Card';
import { timeAgo } from '../../../crm/utils';
import { SupportService, type SupportTicket, type TicketStatus } from '../../services/SupportService';
import { RaiseTicketModal } from './RaiseTicketModal';
import { SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_PHONE_HREF, SUPPORT_WHATSAPP_HREF } from './contact';

const CONTACTS: Array<{ icon: LucideIcon; label: string; value: string; href: string }> = [
  { icon: Phone, label: 'Call us', value: SUPPORT_PHONE, href: SUPPORT_PHONE_HREF },
  { icon: Mail, label: 'Email', value: SUPPORT_EMAIL, href: `mailto:${SUPPORT_EMAIL}` },
  { icon: MessageSquare, label: 'WhatsApp', value: 'Chat with us', href: SUPPORT_WHATSAPP_HREF },
];

const STATUS_META: Record<TicketStatus, { label: string; color: string }> = {
  open: { label: 'Open', color: 'var(--info)' },
  in_progress: { label: 'In progress', color: 'var(--accent)' },
  resolved: { label: 'Resolved', color: 'var(--success)' },
  closed: { label: 'Closed', color: 'var(--text-muted)' },
};

const FAQS: Array<{ q: string; a: string }> = [
  {
    q: 'How long does a mutual fund purchase take to reflect?',
    a: 'Orders placed before the 3:00 PM BSE StAR MF cut-off are processed at the same day’s NAV. Units typically reflect in your portfolio within 1–2 working days after fund realisation.',
  },
  {
    q: 'How do I redeem or switch my investments?',
    a: 'Open Mutual Funds → My Funds, then choose Redeem or Switch on any holding. Redemptions are credited to your registered bank account per the fund’s settlement cycle.',
  },
  {
    q: 'Can I change my registered bank account?',
    a: 'Bank and KYC changes are regulated and require verification. Contact your relationship manager and we’ll guide you through the process securely.',
  },
  {
    q: 'Where can I download my statements?',
    a: 'Reports → download your Transaction or Holdings statement as an Excel workbook. Capital Gains and the official CAS will be available in a later update.',
  },
  {
    q: 'Is my data secure?',
    a: 'Your portal is private to you. Documents are served over short-lived secure links and sensitive account numbers are masked on screen.',
  },
];

function FaqItem({ q, a, open, onToggle }: { q: string; a: string; open: boolean; onToggle: () => void }) {
  return (
    <div className="border-b border-border-subtle last:border-0">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-3 py-3.5 text-left">
        <span className="text-sm font-semibold text-text-primary">{q}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <p className="pb-3.5 text-xs leading-relaxed text-text-secondary">{a}</p>}
    </div>
  );
}

function TicketRow({ ticket }: { ticket: SupportTicket }) {
  const meta = STATUS_META[ticket.status];
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border-subtle py-3 last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-text-faint">{ticket.ref}</span>
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ color: meta.color, background: `color-mix(in srgb, ${meta.color} 12%, transparent)` }}
          >
            {meta.label}
          </span>
        </div>
        <p className="mt-0.5 truncate text-sm font-semibold text-text-primary">{ticket.subject}</p>
      </div>
      <span className="shrink-0 whitespace-nowrap text-xs text-text-muted">{timeAgo(ticket.created_at)}</span>
    </div>
  );
}

export function SupportPage({ clientId }: { clientId: string }) {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(true);

  const loadTickets = useCallback(async () => {
    setLoadingTickets(true);
    try {
      setTickets(await SupportService.listTickets(clientId));
    } catch {
      setTickets([]);
    } finally {
      setLoadingTickets(false);
    }
  }, [clientId]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  return (
    <div className="space-y-5">
      {/* RM hero */}
      <Card accent>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-token-xl bg-accent/10">
              <Headphones className="h-5 w-5 text-accent" />
            </span>
            <div>
              <p className="text-sm font-bold text-text-primary">Your relationship team is here to help</p>
              <p className="text-xs text-text-secondary">Available Mon–Sat, 9:00 AM – 7:00 PM IST.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowTicketModal(true)}
            className="inline-flex items-center justify-center gap-2 rounded-token-md px-4 py-2.5 text-sm font-bold text-on-accent"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
          >
            <MessageSquare className="h-4 w-4" /> Raise a Ticket
          </button>
        </div>
      </Card>

      {/* Contact methods */}
      <div className="grid gap-4 sm:grid-cols-3">
        {CONTACTS.map((c) => (
          <a
            key={c.label}
            href={c.href}
            target={c.href.startsWith('http') ? '_blank' : undefined}
            rel="noopener"
            className="lift flex items-center gap-3 rounded-token-xl border border-border bg-bg-elevated p-4 shadow-token-card transition-colors hover:border-accent/40"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-token-lg bg-accent/10">
              <c.icon className="h-5 w-5 text-accent" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-text-faint">{c.label}</p>
              <p className="truncate text-sm font-semibold text-text-primary">{c.value}</p>
            </div>
          </a>
        ))}
      </div>

      {/* Your tickets */}
      <Card>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-bold text-text-primary">
            <Ticket className="h-4 w-4 text-accent" /> Your tickets
          </h3>
          <button
            type="button"
            onClick={() => setShowTicketModal(true)}
            className="text-xs font-semibold text-accent hover:underline"
          >
            New ticket
          </button>
        </div>
        {loadingTickets ? (
          <p className="py-3 text-xs text-text-muted">Loading…</p>
        ) : tickets.length === 0 ? (
          <p className="py-3 text-xs text-text-secondary">
            You haven’t raised any tickets yet. Use “Raise a Ticket” and we’ll get back to you.
          </p>
        ) : (
          <div>
            {tickets.map((t) => (
              <TicketRow key={t.id} ticket={t} />
            ))}
          </div>
        )}
      </Card>

      {/* FAQ */}
      <Card>
        <h3 className="mb-1 text-sm font-bold text-text-primary">Frequently Asked Questions</h3>
        <div>
          {FAQS.map((f, i) => (
            <FaqItem key={f.q} q={f.q} a={f.a} open={openFaq === i} onToggle={() => setOpenFaq(openFaq === i ? null : i)} />
          ))}
        </div>
      </Card>

      {showTicketModal && (
        <RaiseTicketModal
          clientId={clientId}
          onClose={() => setShowTicketModal(false)}
          onCreated={loadTickets}
        />
      )}
    </div>
  );
}
