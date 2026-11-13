/**
 * Phone bottom tab bar, shared by the client and partner portals.
 *
 * Four or five destinations a user opens most, one-handed, plus an optional
 * "More" tab for everything else. Hidden from `lg` up, where the surface shows
 * its desktop navigation instead. The page under it needs bottom padding
 * (`pb-28 lg:pb-10` is what the portals use) so content isn't hidden.
 */
import type { LucideIcon } from 'lucide-react';

export interface MobileTab {
  key: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onSelect: () => void;
  /** Small count dot on the icon, e.g. unread items. Hidden when 0. */
  badge?: number;
}

export function MobileTabBar({ tabs, label = 'Main' }: { tabs: MobileTab[]; label?: string }) {
  return (
    <nav
      aria-label={label}
      className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-border-subtle bg-header/95 backdrop-blur lg:hidden"
    >
      <div className="mx-auto flex max-w-lg items-stretch">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={t.onSelect}
              aria-current={t.active ? 'page' : undefined}
              className={`relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[10px] font-semibold transition-colors ${
                t.active ? 'text-accent' : 'text-text-faint'
              }`}
            >
              {t.active && (
                <span aria-hidden className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-accent" />
              )}
              <span className="relative">
                <Icon className="h-5 w-5" />
                {!!t.badge && (
                  <span className="absolute -right-2 -top-1.5 min-w-[16px] rounded-full bg-danger px-1 text-center text-[9px] font-bold leading-4 text-white">
                    {t.badge > 99 ? '99+' : t.badge}
                  </span>
                )}
              </span>
              {t.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
