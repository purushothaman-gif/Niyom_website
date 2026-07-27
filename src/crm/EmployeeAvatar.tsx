import React, { useState, useEffect } from 'react';

interface Props {
  name: string;
  url?: string | null;
  /** Square size in px. */
  size?: number;
  /** Corner radius token — matches the badge each call site replaced. */
  rounded?: 'lg' | 'xl' | 'full';
  /** Extra classes for the initials-badge tint (background/color). */
  badgeClassName?: string;
  /** Inline style for the initials badge (background/color), when not using classes. */
  badgeStyle?: React.CSSProperties;
  /** Font size class for the initials text. Defaults to text-xs. */
  textClassName?: string;
}

function initials(name: string): string {
  return name
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Profile picture for an employee/admin. Renders the photo when `url` is set,
 * falling back to the initials badge when there's no photo or the image fails
 * to load (broken/expired object).
 */
export function EmployeeAvatar({
  name,
  url,
  size = 36,
  rounded = 'xl',
  badgeClassName,
  badgeStyle,
  textClassName = 'text-xs',
}: Props) {
  const [failed, setFailed] = useState(false);
  // Reset the fallback when the url changes (e.g. after a re-upload).
  useEffect(() => { setFailed(false); }, [url]);

  const radius = rounded === 'full' ? '9999px' : rounded === 'lg' ? '0.5rem' : '0.75rem';
  const box: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    flexShrink: 0,
  };

  if (url && !failed) {
    return (
      <img
        src={url}
        alt={name}
        onError={() => setFailed(true)}
        style={{ ...box, objectFit: 'cover' }}
      />
    );
  }

  return (
    <div
      className={`flex items-center justify-center font-bold ${textClassName} ${badgeClassName ?? ''}`}
      style={{ ...box, ...badgeStyle }}
    >
      {initials(name)}
    </div>
  );
}

export default EmployeeAvatar;
