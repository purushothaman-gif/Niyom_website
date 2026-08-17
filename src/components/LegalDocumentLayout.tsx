import { X, ArrowLeft } from 'lucide-react';
import { ReactNode } from 'react';

interface LegalDocumentLayoutProps {
  /** Defaults to the site-wide date; pass one for a newer document. */
  effectiveDate?: string;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

export function LegalDocumentLayout({
  title,
  subtitle,
  icon,
  onClose,
  children,
  /* The site-wide legal effective date. Overridden only by documents published
   * later than it — a page dated before the thing it describes existed reads as
   * boilerplate, and a Play reviewer reads this one closely. */
  effectiveDate = 'February 13, 2026',
}: LegalDocumentLayoutProps) {
  return (
    <div className="min-h-screen bg-bg-base">
      <div className="sticky top-0 z-50 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white shadow-2xl border-b border-slate-700">
        <div className="max-w-6xl mx-auto px-8 py-5 flex justify-between items-center">
          <button
            onClick={onClose}
            className="flex items-center gap-3 hover:text-accent-soft transition-all duration-300 font-medium group"
          >
            <ArrowLeft size={22} className="group-hover:-translate-x-1 transition-transform" />
            <span className="tracking-wide text-sm uppercase">Back to Home</span>
          </button>
          <button
            onClick={onClose}
            className="text-white hover:text-accent-soft transition-colors p-2 hover:bg-slate-700 rounded-lg"
          >
            <X size={26} />
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 sm:px-8 py-12 sm:py-16">
        <div className="bg-bg-elevated rounded-xl shadow-2xl border border-border overflow-hidden">
          <div className="bg-gradient-to-r from-bg-raised to-bg-elevated p-8 sm:p-12 border-b-2 border-border">
            <div className="flex items-start gap-6 mb-6">
              {icon && <div className="flex-shrink-0">{icon}</div>}
              <div className="flex-1">
                <h1
                  className="text-4xl sm:text-5xl font-bold text-text-primary mb-3 leading-tight"
                  style={{ fontFamily: 'Georgia, "Times New Roman", serif', letterSpacing: '-0.025em' }}
                >
                  {title}
                </h1>
                {subtitle && (
                  <p className="text-lg text-text-secondary font-light tracking-wide">{subtitle}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold text-text-secondary uppercase tracking-wider">Effective Date:</span>
              <span className="text-text-secondary">{effectiveDate}</span>
            </div>
          </div>

          <div className="p-8 sm:p-12">
            {children}
          </div>
        </div>

        <div className="text-center mt-8 text-sm text-text-muted">
          <p>&copy; 2025 Niyom Wealth Distribution LLP. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}

interface SectionProps {
  number: string;
  title: string;
  children: ReactNode;
  variant?: 'default' | 'warning' | 'danger' | 'info';
}

export function LegalSection({ number, title, children, variant = 'default' }: SectionProps) {
  const bgColors = {
    default: '',
    warning: 'bg-warning/10 border-l-4 border-warning',
    danger: 'bg-danger/10 border-l-4 border-danger',
    info: 'bg-info/10 border-l-4 border-info'
  };

  const containerClass = variant === 'default'
    ? 'mb-10'
    : `mb-10 p-6 rounded-r-lg ${bgColors[variant]}`;

  return (
    <section className={containerClass}>
      <h2
        className="text-xl sm:text-2xl font-bold text-text-primary mb-4 flex items-baseline gap-3"
        style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
      >
        <span className="text-accent">{number}.</span>
        <span>{title}</span>
      </h2>
      <div className="space-y-3 text-text-secondary" style={{ fontSize: '14px', lineHeight: '1.6' }}>
        {children}
      </div>
    </section>
  );
}

interface SubsectionProps {
  number: string;
  title: string;
  children: ReactNode;
}

export function LegalSubsection({ number, title, children }: SubsectionProps) {
  return (
    <div className="mt-5 mb-5">
      <h3 className="text-lg font-semibold text-text-primary mb-3 flex items-baseline gap-2">
        <span className="text-accent">{number}</span>
        <span>{title}</span>
      </h3>
      <div className="space-y-3" style={{ fontSize: '14px', lineHeight: '1.6' }}>
        {children}
      </div>
    </div>
  );
}

interface LegalListProps {
  items: ReactNode[];
  ordered?: boolean;
}

export function LegalList({ items, ordered = false }: LegalListProps) {
  const ListTag = ordered ? 'ol' : 'ul';
  const listClass = ordered ? 'list-decimal' : 'list-disc';

  return (
    <ListTag className={`${listClass} pl-6 space-y-2 text-text-secondary`} style={{ fontSize: '14px', lineHeight: '1.6' }}>
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ListTag>
  );
}

interface AlertBoxProps {
  type: 'warning' | 'danger' | 'info' | 'success';
  children: ReactNode;
}

export function AlertBox({ type, children }: AlertBoxProps) {
  const styles = {
    warning: 'bg-warning/10 border-warning/40 text-text-primary',
    danger: 'bg-danger/10 border-danger/40 text-text-primary',
    info: 'bg-info/10 border-info/40 text-text-primary',
    success: 'bg-success/10 border-success/40 text-text-primary'
  };

  return (
    <div className={`border-2 ${styles[type]} p-5 rounded-lg font-medium`} style={{ fontSize: '14px', lineHeight: '1.6' }}>
      {children}
    </div>
  );
}

interface ContactBoxProps {
  company: string;
  email: string;
  phone: string;
}

export function ContactBox({ company, email, phone }: ContactBoxProps) {
  return (
    <div className="bg-bg-base border-2 border-border p-6 rounded-lg" style={{ fontSize: '14px', lineHeight: '1.6' }}>
      <p className="font-bold text-text-primary mb-3" style={{ fontSize: '16px' }}>{company}</p>
      <div className="space-y-1.5 text-text-secondary">
        <p><span className="font-semibold">Email:</span> {email}</p>
        <p><span className="font-semibold">Phone:</span> {phone}</p>
      </div>
    </div>
  );
}
