import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePreference } from './ThemeContext';

interface ThemeToggleProps {
  /**
   * Visual style: a sliding switch, a compact icon button, or a three-way
   * Light / Dark / System segmented control (for settings pages).
   */
  variant?: 'switch' | 'icon' | 'segmented';
  className?: string;
}

/**
 * Polished, accessible Dark/Light toggle. Consumes theme tokens so it looks
 * correct in either theme. Animations respect prefers-reduced-motion via the
 * global transition rules in index.css.
 */
export function ThemeToggle({ variant = 'switch', className = '' }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const label = `Switch to ${isDark ? 'light' : 'dark'} mode`;

  if (variant === 'segmented') return <ThemeSegmented className={className} />;

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={label}
        title={label}
        className={`relative w-9 h-9 rounded-xl flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 ${className}`}
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          color: 'var(--text-secondary)',
          // @ts-expect-error CSS custom prop for the focus ring color
          '--tw-ring-color': 'rgba(var(--accent-rgb), 0.5)',
        }}
      >
        <Sun
          className="w-4 h-4 absolute transition-all duration-300"
          style={{ opacity: isDark ? 0 : 1, transform: `rotate(${isDark ? -90 : 0}deg) scale(${isDark ? 0.5 : 1})` }}
        />
        <Moon
          className="w-4 h-4 absolute transition-all duration-300"
          style={{ opacity: isDark ? 1 : 0, transform: `rotate(${isDark ? 0 : 90}deg) scale(${isDark ? 1 : 0.5})` }}
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={label}
      title={label}
      onClick={toggleTheme}
      className={`relative inline-flex items-center h-8 w-[58px] rounded-full transition-colors focus:outline-none focus-visible:ring-2 ${className}`}
      style={{
        background: isDark ? 'rgba(var(--accent-rgb), 0.12)' : 'var(--bg-raised)',
        border: '1px solid var(--border)',
        // @ts-expect-error CSS custom prop for the focus ring color
        '--tw-ring-color': 'rgba(var(--accent-rgb), 0.5)',
      }}
    >
      {/* Track icons */}
      <Sun
        className="w-3.5 h-3.5 absolute left-2 transition-opacity duration-300"
        style={{ color: 'var(--warning)', opacity: isDark ? 0.35 : 0 }}
      />
      <Moon
        className="w-3.5 h-3.5 absolute right-2 transition-opacity duration-300"
        style={{ color: 'var(--accent-soft)', opacity: isDark ? 0 : 0.35 }}
      />
      {/* Sliding knob */}
      <span
        className="inline-flex items-center justify-center w-6 h-6 rounded-full shadow-md transition-transform duration-300 ease-out"
        style={{
          background: 'var(--bg-elevated)',
          color: isDark ? 'var(--accent)' : 'var(--warning)',
          transform: isDark ? 'translateX(28px)' : 'translateX(3px)',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        {isDark ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
      </span>
    </button>
  );
}

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

/** Light / Dark / System picker. "System" follows the device setting live. */
function ThemeSegmented({ className = '' }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className={`inline-flex items-center gap-0.5 rounded-xl p-0.5 ${className}`}
      style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setPreference(value)}
            className="inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-xs font-semibold"
            style={{
              background: active ? 'var(--bg-elevated)' : 'transparent',
              color: active ? 'var(--text-primary)' : 'var(--text-muted)',
              boxShadow: active ? 'var(--shadow-sm)' : 'none',
              border: `1px solid ${active ? 'var(--border)' : 'transparent'}`,
            }}
          >
            <Icon
              className="h-3.5 w-3.5"
              style={{ color: active ? 'var(--accent-soft)' : 'currentColor' }}
            />
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default ThemeToggle;
