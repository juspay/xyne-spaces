import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';

/**
 * The glow along the composer's top edge while the mic is listening — the
 * "Xyne found it" glow from the composer demo (demos/composer-context-demo,
 * ComposerGlow), driven by `active` instead of a one-shot play:
 *
 *   on   after 0.15 s a soft pink → violet → blue → teal glow grows out from
 *        the middle (width 55% → 100%, height 25% → 100%), sharpens and fades
 *        up to 30% over 0.7 s, then holds, its colours drifting sideways.
 *   off  it sweeps up 90px, stretches 2.4× tall and fades out over 0.8 s.
 *
 * A small clock writes straight to the glow's style each frame, so the
 * composer doesn't re-render 60 times a second.
 */

type Ease = [number, number, number, number];

/** Every number in the effect. Times and durations in seconds, sizes in px. */
const GLOW = {
  aurora: {
    /** When the glow starts forming, after the mic turns on. */
    at: 0.15,
    /** Opacity it fades up to, and how long that takes. */
    opacity: 0.3,
    fadeIn: 0.25,
    /** Rises from 6px below its resting place, over 0.5 s. */
    riseFrom: 6,
    rise: 0.5,
    /** Grows in (width, height, sharpness, opacity) over 0.7 s. */
    grow: 0.7,
    height: 26,
    blur: 20,
    /** Extra blur at the start of growing, gone when fully grown. */
    growBlur: 12,
    /** Width and height it grows from, as a fraction of full size. */
    growFromScaleX: 0.55,
    growFromScaleY: 0.25,
  },
  sweep: {
    duration: 0.8,
    /** How far it rises (px, negative is up) and how tall it stretches. */
    y: -90,
    scaleY: 2.4,
  },
  ease: {
    /** Fade-in and rise: fast start, long settle. */
    out: [0.22, 1, 0.36, 1] as Ease,
    /** Growing in: soft start, gentle settle. */
    form: [0.4, 0, 0.2, 1] as Ease,
    /** The sweep's rise: keeps moving to the end. */
    rise: [0.3, 0.7, 0.4, 1] as Ease,
    /** The sweep's fade: runs the whole way, fastest in the middle. */
    fade: [0.4, 0, 0.6, 1] as Ease,
  },
  look: {
    /** Inset from the composer's sides, % of its width. */
    inset: 2,
    /** How far the glow's bottom tucks below the composer's top edge. */
    tuck: 12,
    radius: 30,
    /** Pink → violet → blue → teal → pink, drifting sideways once every 3 s. */
    gradient:
      'linear-gradient(90deg, rgba(236,72,153,.6), rgba(139,92,246,.6), rgba(59,130,246,.55), rgba(20,184,166,.55), rgba(236,72,153,.6))',
    drift: 3,
  },
};

/** A CSS cubic-bezier as a function of progress 0–1. */
function bezier([x1, y1, x2, y2]: Ease): (p: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const x = (s: number): number => ((ax * s + bx) * s + cx) * s;
  const dx = (s: number): number => (3 * ax * s + 2 * bx) * s + cx;
  const y = (s: number): number => ((ay * s + by) * s + cy) * s;
  return p => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let s = p;
    for (let i = 0; i < 8; i++) {
      const d = dx(s);
      if (Math.abs(d) < 1e-6) break;
      s -= (x(s) - p) / d;
    }
    // Fall back to bisection if Newton wandered off.
    if (s < 0 || s > 1 || Math.abs(x(s) - p) > 1e-4) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 30; i++) {
        s = (lo + hi) / 2;
        if (x(s) < p) lo = s;
        else hi = s;
      }
    }
    return y(s);
  };
}

const ease = {
  out: bezier(GLOW.ease.out),
  form: bezier(GLOW.ease.form),
  rise: bezier(GLOW.ease.rise),
  fade: bezier(GLOW.ease.fade),
};
const clamp = (p: number): number => Math.min(1, Math.max(0, p));

interface GlowFrame {
  visible: boolean;
  opacity: number;
  y: number;
  scaleX: number;
  scaleY: number;
  blur: number;
}

/** The glow `t` seconds after the mic turned on. */
function formingAt(t: number): GlowFrame {
  const a = GLOW.aurora;
  const ta = t - a.at;
  if (ta < 0) {
    return {
      visible: false,
      opacity: 0,
      y: a.riseFrom,
      scaleX: a.growFromScaleX,
      scaleY: a.growFromScaleY,
      blur: a.blur + a.growBlur,
    };
  }
  const g = ease.form(clamp(ta / a.grow));
  return {
    visible: true,
    opacity: Math.min(1, a.opacity * ease.out(clamp(ta / a.fadeIn)) * g),
    y: a.riseFrom * (1 - ease.out(clamp(ta / a.rise))),
    scaleX: a.growFromScaleX + (1 - a.growFromScaleX) * g,
    scaleY: a.growFromScaleY + (1 - a.growFromScaleY) * g,
    blur: a.blur + a.growBlur * (1 - g),
  };
}

/** The glow `t` seconds after the mic turned off: it rises, stretches and fades. */
function sweepingAt(t: number): GlowFrame {
  const s = GLOW.sweep;
  const p = clamp(t / s.duration);
  return {
    visible: p < 1,
    opacity: Math.min(1, GLOW.aurora.opacity * (1 - ease.fade(p))),
    y: s.y * ease.rise(p),
    scaleX: 1,
    scaleY: 1 + (s.scaleY - 1) * ease.rise(p),
    blur: GLOW.aurora.blur,
  };
}

const FORM_END = GLOW.aurora.at + Math.max(GLOW.aurora.grow, GLOW.aurora.rise, GLOW.aurora.fadeIn);

function apply(el: HTMLElement, f: GlowFrame): void {
  el.style.visibility = f.visible ? 'visible' : 'hidden';
  el.style.opacity = String(f.opacity);
  el.style.filter = `blur(${f.blur}px)`;
  el.style.transform = `translateY(${f.y}px) scale(${f.scaleX}, ${f.scaleY})`;
}

export function ComposerGlow({
  active,
  children,
}: {
  /** The mic is listening: the glow forms and holds; turning off sweeps it away. */
  active: boolean;
  /** The composer box. The glow sits behind it, along its top edge. */
  children: ReactNode;
}): ReactElement {
  const glow = useRef<HTMLDivElement | null>(null);
  const shown = useRef(false);

  useEffect(() => {
    const el = glow.current;
    if (!el || (!active && !shown.current)) return undefined;
    shown.current = active;
    const frameAt = active ? formingAt : sweepingAt;
    const end = active ? FORM_END : GLOW.sweep.duration;
    // Reduced motion: keep the fade, drop the movement and stretching.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number): void => {
      const t = Math.min(end, (now - start) / 1000);
      const f = frameAt(t);
      apply(el, reduced ? { ...f, y: 0, scaleX: 1, scaleY: 1 } : f);
      if (t < end) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return (): void => cancelAnimationFrame(raf);
  }, [active]);

  const { look, aurora } = GLOW;
  return (
    <div className='relative'>
      <div
        ref={glow}
        aria-hidden
        className='pointer-events-none absolute z-0'
        style={{
          left: `${look.inset}%`,
          right: `${look.inset}%`,
          bottom: `calc(100% - ${look.tuck}px)`,
          height: aurora.height,
          borderRadius: look.radius,
          background: look.gradient,
          backgroundSize: '200% 100%',
          animation: `composer-glow-drift ${look.drift}s linear infinite`,
          visibility: 'hidden',
          opacity: 0,
        }}
      />
      <div className='relative z-[1]'>{children}</div>
    </div>
  );
}
