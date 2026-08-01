import { useEffect, useState, type CSSProperties } from 'react';

interface Props {
  name: string;
  url?: string | null;
  /** Square size in px. */
  size?: number;
  /** Extra classes for the initials fallback (usually a tint). */
  className?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'N';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

/**
 * The client's own face in the portal — photo when they have set one, their
 * initials when they have not. A broken or expired object falls back to the
 * initials rather than leaving a torn-image icon in the header.
 */
export function ClientAvatar({ name, url, size = 36, className = '' }: Props) {
  const [failed, setFailed] = useState(false);
  // Reset after a re-upload, or the old failure would hide the new photo.
  useEffect(() => setFailed(false), [url]);

  const box: CSSProperties = { width: size, height: size, borderRadius: '9999px', flexShrink: 0 };

  if (url && !failed) {
    return (
      <img
        src={url}
        alt={name}
        onError={() => setFailed(true)}
        style={{ ...box, objectFit: 'cover' }}
        className="border border-border-subtle"
      />
    );
  }

  return (
    <span
      className={`flex items-center justify-center font-bold text-accent ${className || 'bg-accent/15'}`}
      style={{ ...box, fontSize: Math.max(10, Math.round(size * 0.36)) }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
