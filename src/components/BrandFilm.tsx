import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Film, Volume2, VolumeX } from 'lucide-react';

/**
 * BrandFilm — the premium cinematic brand-film for the landing hero.
 *
 * Replaces the old HeroShowcase ("Diversified Portfolio" panel). It renders a
 * letterboxed cinema frame (grain + vignette + slow gold light-sweep) with two
 * content modes:
 *
 *  1. Video mode — if `/brand-film.mp4` exists in `public/`, it auto-plays
 *     (muted, looped). We HEAD-probe first so a missing file produces no noisy
 *     404 in the console; the moment the founder drops a Veo/Flow export in,
 *     it takes over with zero code changes.
 *  2. Self-running sequence (default) — the film's gold-on-black title cards
 *     cycle and loop, each paired with a one-line voice-over subtitle, gentle
 *     Ken-Burns motion and warm per-scene grading. This is the always-present
 *     premium fallback so the hero is never empty.
 *
 * Perf / a11y:
 *  - One React render per scene (~timed interval) — transitions are pure CSS.
 *  - Honors `prefers-reduced-motion`: no auto-advance, no motion; the closing
 *    CTA card is shown statically.
 *  - Card text is meaningful, so the region is labelled (not aria-hidden).
 */

const prefersReduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Scene = {
  /** Small uppercase kicker naming the chapter. */
  kicker: string;
  /** The gold title-card text (verbatim from the film's screen text). */
  title: string;
  /** One-line voice-over subtitle (doubles as the VO script). */
  vo?: string;
  /** Warm scene tint — evokes the live scene without stock photos. */
  glow: string;
  /** Hold duration for this card, in ms. */
  hold: number;
  /** Closing CTA card gets the button + wordmark treatment. */
  cta?: boolean;
};

const SCENES: Scene[] = [
  {
    kicker: 'Retirement',
    title: 'FINANCIAL FREEDOM',
    vo: 'Every great future begins with a single decision.',
    glow: 'radial-gradient(70% 60% at 50% 38%, rgba(216,189,134,0.20), transparent 72%)',
    hold: 4200,
  },
  {
    kicker: 'Comfort',
    title: 'A HAPPY RETIREMENT',
    vo: 'The years you worked for — spent exactly as you dreamed.',
    glow: 'radial-gradient(75% 65% at 42% 32%, rgba(240,200,120,0.22), transparent 74%)',
    hold: 4200,
  },
  {
    kicker: 'Education',
    title: 'DREAMS COME TRUE',
    vo: 'Her ambitions, fully funded. Her path, wide open.',
    glow: 'radial-gradient(72% 62% at 58% 36%, rgba(216,189,134,0.22), transparent 72%)',
    hold: 4200,
  },
  {
    kicker: 'Protection',
    title: 'PROTECTION WHEN LIFE MATTERS MOST',
    vo: 'Certainty, exactly when your family needs it.',
    glow: 'radial-gradient(70% 60% at 50% 40%, rgba(200,164,93,0.20), transparent 72%)',
    hold: 4600,
  },
  {
    kicker: 'Legacy',
    title: 'THE LIFE YOUR FAMILY DESERVES',
    vo: 'A home, a legacy — a life well built.',
    glow: 'radial-gradient(80% 68% at 50% 34%, rgba(240,206,140,0.24), transparent 74%)',
    hold: 4400,
  },
  {
    kicker: 'For you',
    title: 'YOU DESERVE THIS.',
    glow: 'radial-gradient(66% 58% at 50% 42%, rgba(216,189,134,0.18), transparent 72%)',
    hold: 3000,
  },
  {
    kicker: 'NIYOM Wealth',
    title: 'Build Wealth with Confidence',
    vo: 'Small investments. Bigger happiness.',
    glow: 'radial-gradient(78% 66% at 50% 40%, rgba(216,189,134,0.26), transparent 74%)',
    hold: 5200,
    cta: true,
  },
];

/** Faint film-grain via inline SVG turbulence (data-URI, no network). */
const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/></svg>\")";

export function BrandFilm({ className = '' }: { className?: string }) {
  const reduced = prefersReduced();
  const [mounted, setMounted] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  // On reduced-motion, park on the closing CTA card and never advance.
  const [i, setI] = useState(() => (reduced ? SCENES.length - 1 : 0));
  const iRef = useRef(i);
  iRef.current = i;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    // A user gesture: (re)start playback in case autoplay was deferred.
    if (!v.muted) void v.play().catch(() => {});
    setMuted(v.muted);
  };

  // Entrance.
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Probe for a dropped-in film export. HEAD avoids downloading; a missing
  // file simply keeps the CSS sequence (and logs nothing user-facing).
  useEffect(() => {
    let alive = true;
    fetch('/brand-film.mp4', { method: 'HEAD' })
      .then(r => {
        if (alive && r.ok && (r.headers.get('content-type') ?? '').includes('video')) {
          setHasVideo(true);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Nudge muted autoplay once the video mounts (some engines defer the
  // autoplay attribute until an explicit play() call).
  useEffect(() => {
    if (!hasVideo) return;
    const v = videoRef.current;
    if (v) void v.play().catch(() => {});
  }, [hasVideo]);

  // Scene auto-advance (skipped for reduced-motion and when video plays).
  useEffect(() => {
    if (reduced || hasVideo) return;
    let timer: number;
    const schedule = () => {
      timer = window.setTimeout(() => {
        setI(prev => (prev + 1) % SCENES.length);
        schedule();
      }, SCENES[iRef.current].hold);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [reduced, hasVideo]);

  const enter = useMemo<React.CSSProperties>(
    () => ({
      opacity: mounted ? 1 : 0,
      transform: mounted ? 'translateY(0) scale(1)' : 'translateY(22px) scale(0.985)',
      transition:
        'opacity 0.8s cubic-bezier(0.16,1,0.3,1) 120ms, transform 0.8s cubic-bezier(0.16,1,0.3,1) 120ms',
    }),
    [mounted]
  );

  const scene = SCENES[i];

  return (
    <div className={`relative w-full max-w-[540px] mx-auto ${className}`}>
      {/* Ambient glow behind the frame */}
      <div
        className="absolute -inset-6 -z-10"
        style={{
          background:
            'radial-gradient(60% 55% at 55% 42%, rgba(200,164,93,0.20), transparent 70%)',
          filter: 'blur(26px)',
        }}
      />

      {/* Cinema frame */}
      <div
        role="img"
        aria-label="NIYOM Wealth brand film — Build Wealth with Confidence"
        className={`relative overflow-hidden rounded-3xl ${
          hasVideo ? 'aspect-video' : 'aspect-[4/5] sm:aspect-[16/10]'
        }`}
        style={{
          background: 'linear-gradient(160deg, #0a1a30 0%, #05101f 55%, #030a15 100%)',
          border: '1px solid rgba(200,164,93,0.28)',
          boxShadow:
            '0 34px 90px rgba(2,8,20,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
          ...enter,
        }}
      >
        {/* ---- Video mode (drop-in) ---- */}
        {hasVideo && (
          <>
            <video
              ref={videoRef}
              className="absolute inset-0 h-full w-full object-cover"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              poster="/brand-film-poster.jpg"
            >
              <source src="/brand-film.mp4" type="video/mp4" />
            </video>

            {/* Sound toggle — the film is narrated, so let visitors hear it.
                Autoplay must start muted; this is the user gesture that unmutes. */}
            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? 'Unmute film' : 'Mute film'}
              className="press absolute bottom-4 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full backdrop-blur"
              style={{
                background: 'rgba(3,10,21,0.6)',
                border: '1px solid rgba(216,189,134,0.35)',
                color: '#d8bd86',
              }}
            >
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
          </>
        )}

        {/* ---- Self-running sequence ---- */}
        {!hasVideo && (
          <>
            {/* Per-scene warm glow (crossfades on scene change) */}
            <div
              key={`glow-${i}`}
              className="absolute inset-0"
              style={{ background: scene.glow, animation: reduced ? undefined : 'bf-glow 700ms ease-out both' }}
            />

            {/* Card content */}
            <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
              <div key={`card-${i}`} style={{ animation: reduced ? undefined : 'bf-card 800ms cubic-bezier(0.16,1,0.3,1) both' }}>
                <p
                  className="text-[10px] sm:text-[11px] uppercase tracking-[0.34em] mb-4"
                  style={{ color: 'rgba(216,189,134,0.72)' }}
                >
                  {scene.kicker}
                </p>

                {scene.cta ? (
                  <>
                    <p
                      className="text-[11px] uppercase tracking-[0.28em] text-gray-400 mb-3"
                    >
                      Start Investing Today
                    </p>
                    <h3
                      className="text-2xl sm:text-[1.9rem] font-bold leading-tight"
                      style={{
                        fontFamily: 'var(--font-display)',
                        background: 'linear-gradient(90deg, #b8934a, #f0d59a 55%, #d8bd86)',
                        WebkitBackgroundClip: 'text',
                        backgroundClip: 'text',
                        color: 'transparent',
                      }}
                    >
                      {scene.title}
                    </h3>
                    <p className="text-sm text-gray-300 mt-3">{scene.vo}</p>
                    <button
                      onClick={() => window.open('/onboarding', '_blank')}
                      className="cta-glow press mt-6 inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-bold text-black"
                      style={{ background: 'var(--accent-soft)' }}
                    >
                      Start Investing <ArrowRight size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <h3
                      className="font-bold leading-[1.12] tracking-tight"
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 'clamp(1.5rem, 4.2vw, 2.35rem)',
                        background: 'linear-gradient(90deg, #b8934a, #f0d59a 55%, #d8bd86)',
                        WebkitBackgroundClip: 'text',
                        backgroundClip: 'text',
                        color: 'transparent',
                        textShadow: '0 2px 30px rgba(200,164,93,0.10)',
                      }}
                    >
                      {scene.title}
                    </h3>
                    {scene.vo && (
                      <p className="mx-auto mt-4 max-w-[22rem] text-sm sm:text-[0.95rem] italic leading-relaxed text-gray-300">
                        {scene.vo}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Slow gold light-sweep */}
            {!reduced && (
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'linear-gradient(105deg, transparent 30%, rgba(240,214,150,0.10) 48%, transparent 62%)',
                  backgroundSize: '260% 100%',
                  animation: 'bf-sweep 9s ease-in-out infinite',
                }}
              />
            )}
          </>
        )}

        {/* ---- Cinema chrome ---- */}
        {/* Vignette — subtle framing, kept in both modes. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(120% 100% at 50% 50%, transparent 58%, rgba(0,0,0,0.42) 100%)' }}
        />

        {/* Letterbox, grain and the wordmark/tag belong to the title-card
            fallback only — real footage carries its own framing and grade. */}
        {!hasVideo && (
          <>
            {/* Letterbox bars */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[7%]" style={{ background: '#02060d' }} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[7%]" style={{ background: '#02060d' }} />

            {/* Film grain */}
            <div
              className="pointer-events-none absolute inset-0 mix-blend-soft-light"
              style={{ backgroundImage: GRAIN, backgroundSize: '140px 140px', opacity: 0.12 }}
            />

            {/* Top-left wordmark + film tag */}
            <div className="pointer-events-none absolute left-4 top-[calc(7%+0.65rem)] flex items-center gap-2">
              <span
                className="text-[10px] font-semibold uppercase tracking-[0.24em]"
                style={{ color: 'rgba(216,189,134,0.85)', fontFamily: 'var(--font-display)' }}
              >
                NIYOM WEALTH
              </span>
            </div>
            <div className="pointer-events-none absolute right-4 top-[calc(7%+0.55rem)] flex items-center gap-1.5 text-[9px] uppercase tracking-[0.18em] text-gray-400">
              <Film size={11} style={{ color: 'rgba(216,189,134,0.7)' }} />
              Brand Film
            </div>
          </>
        )}

        {/* Bottom progress dots (hidden in video mode) */}
        {!hasVideo && (
          <div className="absolute inset-x-0 bottom-[calc(7%+0.7rem)] flex items-center justify-center gap-1.5">
            {SCENES.map((_, idx) => (
              <span
                key={idx}
                className="h-[3px] rounded-full transition-all duration-500"
                style={{
                  width: idx === i ? 20 : 6,
                  background: idx === i ? 'var(--accent-soft)' : 'rgba(216,189,134,0.28)',
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Component-scoped keyframes */}
      <style>{`
        @keyframes bf-card {
          0% { opacity: 0; transform: translateY(14px) scale(0.985); letter-spacing: 0.04em; }
          100% { opacity: 1; transform: translateY(0) scale(1); letter-spacing: normal; }
        }
        @keyframes bf-glow { 0% { opacity: 0; } 100% { opacity: 1; } }
        @keyframes bf-sweep {
          0% { background-position: 140% 0; }
          55% { background-position: -40% 0; }
          100% { background-position: -40% 0; }
        }
      `}</style>
    </div>
  );
}
