// A fund house's or bond issuer's real logo, falling back to whatever monogram /
// icon tile the surface already drew. Same "logo if we have one" behaviour as
// ShareLogo for unlisted shares; logos are uploaded in CRM → Brand Logos.

import type { ReactNode } from 'react';
import { useBrandLogo, type BrandKind } from './brandLogos';

interface Props {
  kind: BrandKind;
  name: string | null | undefined;
  /** Rendered box in px. */
  size?: number;
  className?: string;
  /** Shown when no logo is on file (or while the lookup loads). */
  fallback: ReactNode;
}

export function BrandLogo({ kind, name, size = 40, className = '', fallback }: Props) {
  const url = useBrandLogo(kind, name);
  if (!url) return <>{fallback}</>;
  return (
    <img
      src={url}
      alt={name ?? ''}
      loading="lazy"
      style={{ width: size, height: size, minWidth: size, objectFit: 'contain' }}
      className={`shrink-0 rounded-token-md border border-border bg-white p-1 ${className}`}
    />
  );
}

/**
 * Bond issuer logo. Falls back to the existing tiles: a one-letter monogram in
 * lists (`variant="initial"`), the Landmark icon on detail pages.
 */
export function IssuerLogo({
  issuer, label, size = 36, variant = 'initial', icon,
}: {
  issuer: string | null | undefined;
  /** Text the monogram is taken from when the issuer is blank. */
  label?: string | null;
  size?: number;
  variant?: 'initial' | 'icon';
  /** Rendered inside the fallback tile when variant="icon". */
  icon?: ReactNode;
}) {
  const box = { width: size, height: size, minWidth: size };
  const fallback = variant === 'icon' ? (
    <span style={box} className="flex shrink-0 items-center justify-center rounded-token-lg bg-accent/10">{icon}</span>
  ) : (
    <span
      style={{ ...box, fontSize: Math.round(size * 0.38) }}
      className="flex shrink-0 items-center justify-center rounded-token-lg bg-accent/10 font-display font-bold text-accent"
    >
      {(issuer || label || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
  return <BrandLogo kind="bond_issuer" name={issuer} size={size} fallback={fallback} />;
}
