interface LogoLoaderProps {
  /** Diameter of the mark in pixels. The gold arc sits just outside it. */
  size?: number;
  /** Optional caption rendered under the mark (e.g. "Loading your portfolio"). */
  label?: string;
  /** Render as a centred, theme-aware full-screen overlay. */
  fullscreen?: boolean;
  className?: string;
}

/**
 * Brand loading indicator: the Niyom mark breathing inside a rotating gold arc
 * that echoes the logo's own ring. Colours ride the `--accent` token so it
 * stays on-brand in light and dark, and it degrades to a gentle pulse under
 * `prefers-reduced-motion` (see the `.niyom-loader__*` rules in index.css).
 */
export function LogoLoader({
  size = 96,
  label,
  fullscreen = false,
  className = '',
}: LogoLoaderProps) {
  // The arc lives in a slightly larger box so it clears the mark's edge.
  const box = Math.round(size * 1.32);

  const loader = (
    <div
      className={`flex flex-col items-center justify-center gap-4 ${className}`}
      role="status"
      aria-live="polite"
      aria-label={label ?? 'Loading'}
    >
      <div className="relative" style={{ width: box, height: box }}>
        {/* Soft gold halo */}
        <div
          className="niyom-loader__glow absolute inset-0 rounded-full"
          style={{
            background:
              'radial-gradient(circle, rgba(var(--accent-rgb), 0.35) 0%, transparent 68%)',
          }}
        />

        {/* Rotating gold arc — drawn in the accent colour */}
        <svg
          className="niyom-loader__ring absolute inset-0"
          width={box}
          height={box}
          viewBox="0 0 100 100"
          fill="none"
          aria-hidden="true"
        >
          {/* Faint full track */}
          <circle
            cx="50"
            cy="50"
            r="46"
            stroke="rgb(var(--accent-rgb))"
            strokeOpacity="0.15"
            strokeWidth="3"
          />
          {/* Sweeping leading arc */}
          <circle
            className="niyom-loader__arc"
            cx="50"
            cy="50"
            r="46"
            stroke="rgb(var(--accent-rgb))"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>

        {/* The mark itself, breathing */}
        <div className="absolute inset-0 flex items-center justify-center">
          <img
            src="/niyomlogo.png"
            alt="Niyom Wealth"
            className="niyom-loader__mark rounded-full"
            style={{ width: size, height: size }}
          />
        </div>
      </div>

      {label && (
        <p className="niyom-loader__label font-display text-sm tracking-wide text-text-secondary">
          {label}
        </p>
      )}
    </div>
  );

  if (fullscreen) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-base">
        {loader}
      </div>
    );
  }

  return loader;
}
