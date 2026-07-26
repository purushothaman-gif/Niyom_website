import { useEffect, useRef, useState } from 'react';
import { TrendingUp, ArrowUpRight } from 'lucide-react';

/**
 * HeroShowcase — the premium right-hand visual for the landing hero.
 *
 * A glassmorphic "wealth" panel: an animated asset-allocation ring, an
 * illustrative growth sparkline, and floating asset chips. Everything is
 * decorative and clearly illustrative (no real returns/AUM are implied).
 *
 * Performance / a11y:
 *  - Mouse parallax is driven by CSS variables written to a ref (no React
 *    re-render per frame) and applied via GPU `translate3d`.
 *  - Honors `prefers-reduced-motion`: no parallax, no float, static ring.
 */

const prefersReduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Illustrative allocation — labels + brand-palette colors, sums to 100%. */
const ALLOCATION = [
  { label: 'Mutual Funds', pct: 40, color: '#C8A45D' },
  { label: 'Bonds', pct: 25, color: '#5B8DEF' },
  { label: 'Fixed Deposits', pct: 15, color: '#34D399' },
  { label: 'Unlisted Shares', pct: 12, color: '#A78BFA' },
  { label: 'Insurance', pct: 8, color: '#22D3EE' },
];

// Cumulative conic-gradient stops for the ring.
const conic = (() => {
  let acc = 0;
  const stops = ALLOCATION.map(a => {
    const from = acc;
    acc += a.pct;
    return `${a.color} ${from}% ${acc}%`;
  });
  return `conic-gradient(from -90deg, ${stops.join(', ')})`;
})();

export function HeroShowcase({ className = '' }: { className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const reduced = prefersReduced();

  // Entrance
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Mouse parallax via CSS vars (no re-render).
  useEffect(() => {
    if (reduced) return;
    const el = rootRef.current;
    if (!el) return;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const nx = e.clientX / window.innerWidth - 0.5;
        const ny = e.clientY / window.innerHeight - 0.5;
        el.style.setProperty('--mx', nx.toFixed(3));
        el.style.setProperty('--my', ny.toFixed(3));
      });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(raf);
    };
  }, [reduced]);

  const enter = (delay: number): React.CSSProperties => ({
    opacity: mounted ? 1 : 0,
    transform: mounted ? 'translateY(0) scale(1)' : 'translateY(24px) scale(0.98)',
    transition: `opacity 0.7s cubic-bezier(0.16,1,0.3,1) ${delay}ms, transform 0.7s cubic-bezier(0.16,1,0.3,1) ${delay}ms`,
  });

  // Parallax layer transform — depth multiplies the pointer offset (px).
  const layer = (depth: number): React.CSSProperties =>
    reduced ? {} : { transform: `translate3d(calc(var(--mx,0) * ${depth}px), calc(var(--my,0) * ${depth}px), 0)`, transition: 'transform 0.25s ease-out' };

  return (
    <div ref={rootRef} className={`relative w-full max-w-[460px] mx-auto ${className}`} aria-hidden="true">
      {/* Ambient glow behind the panel */}
      <div
        className="absolute -inset-6 -z-10"
        style={{ background: 'radial-gradient(60% 55% at 60% 40%, rgba(200,164,93,0.22), transparent 70%)', filter: 'blur(24px)', ...layer(-10) }}
      />

      {/* Main glass panel */}
      <div
        className="relative rounded-3xl p-6 sm:p-7"
        style={{
          background: 'linear-gradient(160deg, rgba(22,52,92,0.55), rgba(8,27,51,0.65))',
          border: '1px solid rgba(200,164,93,0.22)',
          boxShadow: '0 30px 80px rgba(2,8,20,0.55), inset 0 1px 0 rgba(255,255,255,0.06)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          ...enter(120),
          ...layer(14),
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-gray-400">Asset Allocation</p>
            <p className="text-sm font-semibold text-white mt-0.5" style={{ fontFamily: 'var(--font-display)' }}>
              Diversified Portfolio
            </p>
          </div>
          <span
            className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full"
            style={{ background: 'rgba(200,164,93,0.14)', border: '1px solid rgba(200,164,93,0.3)', color: '#d8bd86' }}
          >
            Illustrative
          </span>
        </div>

        {/* Ring + legend */}
        <div className="flex items-center gap-6">
          {/* Donut ring (conic gradient masked into a ring) */}
          <div className="relative flex-shrink-0" style={{ width: 132, height: 132 }}>
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: conic,
                WebkitMask: 'radial-gradient(farthest-side, transparent 58%, #000 60%)',
                mask: 'radial-gradient(farthest-side, transparent 58%, #000 60%)',
                transform: mounted ? 'rotate(0deg) scale(1)' : 'rotate(-40deg) scale(0.8)',
                opacity: mounted ? 1 : 0,
                transition: 'transform 0.9s cubic-bezier(0.16,1,0.3,1) 250ms, opacity 0.9s ease 250ms',
              }}
            />
            {/* Center label */}
            <div className="absolute inset-0 flex flex-col items-center justify-center" style={enter(650)}>
              <span className="text-2xl font-bold text-white leading-none" style={{ fontFamily: 'var(--font-display)' }}>5</span>
              <span className="text-[9px] uppercase tracking-wider text-gray-400 mt-1 text-center leading-tight">Asset<br />Classes</span>
            </div>
          </div>

          {/* Legend */}
          <div className="flex-1 space-y-2.5">
            {ALLOCATION.map((a, i) => (
              <div key={a.label} className="flex items-center gap-2.5" style={enter(400 + i * 90)}>
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: a.color }} />
                <span className="text-xs text-gray-300 flex-1 truncate">{a.label}</span>
                <span className="text-xs font-semibold text-white tabular-nums">{a.pct}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="my-5 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)' }} />

        {/* Growth sparkline */}
        <div style={enter(760)}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] uppercase tracking-[0.18em] text-gray-400">Portfolio Trend</p>
            <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: '#34D399' }}>
              <ArrowUpRight className="w-3.5 h-3.5" /> Long-term growth
            </span>
          </div>
          <Sparkline mounted={mounted} reduced={reduced} />
        </div>
      </div>

      {/* Floating chips — hang off the card's outer edges (never over the
          header/content). Nested layers keep position, entrance and parallax
          transforms from clobbering one another. */}
      <FloatingChip pos="top-[44%] left-0 -translate-x-full -ml-2" enterStyle={enter(500)} layerStyle={layer(26)} reduced={reduced} delay="0s">
        <TrendingUp className="w-3.5 h-3.5" style={{ color: '#34D399' }} />
        SIP Ready
      </FloatingChip>
      <FloatingChip pos="top-14 right-0 translate-x-[108%]" enterStyle={enter(640)} layerStyle={layer(20)} reduced={reduced} delay="1.1s">
        <span className="w-2 h-2 rounded-full" style={{ background: '#5B8DEF' }} />
        AAA Bonds
      </FloatingChip>
      <FloatingChip pos="bottom-16 right-0 translate-x-[108%]" enterStyle={enter(780)} layerStyle={layer(30)} reduced={reduced} delay="0.6s">
        <span className="w-2 h-2 rounded-full" style={{ background: '#C8A45D' }} />
        Goal Tracking
      </FloatingChip>
    </div>
  );
}

function FloatingChip({
  children,
  pos,
  enterStyle,
  layerStyle,
  reduced,
  delay,
}: {
  children: React.ReactNode;
  pos: string;
  enterStyle: React.CSSProperties;
  layerStyle: React.CSSProperties;
  reduced: boolean;
  delay: string;
}) {
  return (
    // Layer A: absolute position (translate utilities are safe here — no inline transform).
    // Hidden below md: the chips hang off the panel's outer edges, which would
    // overflow the viewport (horizontal scroll) on a phone. The panel itself
    // still renders on mobile — just without the floating chips.
    <div className={`absolute ${pos} hidden md:block`}>
      {/* Layer B: entrance (opacity + transform). */}
      <div style={enterStyle}>
        {/* Layer C: parallax (transform). */}
        <div style={layerStyle}>
          <div
            className="flex items-center gap-1.5 text-xs font-semibold text-white px-3 py-2 rounded-xl whitespace-nowrap"
            style={{
              background: 'rgba(8,27,51,0.72)',
              border: '1px solid rgba(200,164,93,0.25)',
              boxShadow: '0 10px 30px rgba(2,8,20,0.45)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              animation: reduced ? undefined : `float 5s ease-in-out ${delay} infinite`,
            }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Simple animated area sparkline (SVG stroke-draw + gradient fill). */
function Sparkline({ mounted, reduced }: { mounted: boolean; reduced: boolean }) {
  // A gentle upward line.
  const line = 'M0,46 L26,40 L52,43 L78,32 L104,34 L130,22 L156,25 L182,12 L208,15 L234,4';
  const area = `${line} L234,60 L0,60 Z`;
  const len = 300; // approx path length for the draw animation
  return (
    <svg viewBox="0 0 234 60" className="w-full h-16" preserveAspectRatio="none">
      <defs>
        <linearGradient id="hs-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#C8A45D" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#C8A45D" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="hs-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#b8934a" />
          <stop offset="100%" stopColor="#d8bd86" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#hs-fill)" style={{ opacity: mounted ? 1 : 0, transition: 'opacity 0.8s ease 900ms' }} />
      <path
        d={line}
        fill="none"
        stroke="url(#hs-line)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={
          reduced
            ? undefined
            : {
                strokeDasharray: len,
                strokeDashoffset: mounted ? 0 : len,
                transition: 'stroke-dashoffset 1.4s cubic-bezier(0.16,1,0.3,1) 850ms',
              }
        }
      />
    </svg>
  );
}
