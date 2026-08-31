// A share's company logo, with a deterministic initials fallback.
//
// Every unlisted-share surface (CRM master, client list, partner list, the public
// offer page) needs the same "logo if we have one, tidy monogram if we don't"
// behaviour, and a missing logo is the normal state for a freshly added company —
// so the fallback is the designed path, not an error state.

interface Props {
  name: string;
  url?: string | null;
  /** Rendered box in px. */
  size?: number;
  className?: string;
}

/** Initials from the trading name: "boAt" → BO, "National Stock Exchange" → NS. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function ShareLogo({ name, url, size = 40, className = '' }: Props) {
  const box = { width: size, height: size, minWidth: size };

  if (url) {
    return (
      <img
        src={url}
        alt={name}
        loading="lazy"
        style={{ ...box, objectFit: 'contain' }}
        className={`rounded-token-md bg-white p-1 ${className}`}
      />
    );
  }

  return (
    <div
      style={{ ...box, fontSize: Math.max(10, Math.round(size * 0.36)) }}
      className={`flex items-center justify-center rounded-token-md border border-border bg-bg-raised font-bold text-text-faint ${className}`}
      aria-label={name}
    >
      {initials(name)}
    </div>
  );
}
