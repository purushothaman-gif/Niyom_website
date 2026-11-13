/**
 * A dialog that is a centred modal on tablet/desktop and a bottom sheet on a
 * phone (via the .m-sheet classes in index.css). Use it for new dialogs on any
 * surface; existing hand-built modals can get the same phone behaviour by
 * adding `m-sheet` / `m-sheet-panel` to their two wrapper divs.
 *
 * Owns the dull parts: Escape closes, the page behind stops scrolling, a tap
 * on the backdrop closes (unless `dismissible` is false, e.g. mid-submit).
 */
import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Sheet({
  open,
  onClose,
  title,
  icon,
  children,
  footer,
  width = 'max-w-lg',
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  /** Sticky action row (buttons). Stays visible while the body scrolls. */
  footer?: ReactNode;
  /** Desktop width, a Tailwind max-w-* class. */
  width?: string;
  dismissible?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) onClose();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, dismissible, onClose]);

  if (!open) return null;

  return (
    <div
      className="m-sheet fixed inset-0 z-[60] flex items-center justify-center bg-overlay p-4"
      onClick={dismissible ? onClose : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`m-sheet-panel flex max-h-[92vh] w-full ${width} flex-col overflow-hidden rounded-token-xl border border-border bg-modal shadow-token-lg`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-2">
            {icon}
            <h3 className="truncate text-sm font-bold text-text-primary">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-2 rounded-token-md p-2 text-text-secondary hover:text-text-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
