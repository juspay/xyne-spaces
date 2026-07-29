/**
 * Splash screen shown briefly on first V3 mount.
 *
 * Visual brief: black ground, green neon glow, agentic motifs —
 * matrix-style code rain behind everything, a constellation of orbiting
 * "agent" nodes connected by data lines around the title, RGB-glitched
 * "Claw" wordmark, and a typewriter tagline.
 *
 * - All motion is pure CSS keyframes; one render-time JS loop only seeds
 *   the matrix columns (no rAF).
 * - 2-second hold, 350ms fade-out.
 * - One-shot guard via sessionStorage so it doesn't re-fire on every
 *   route change within the same browser tab.
 */
import { useEffect, useMemo, useRef, useState } from "react";

const SPLASH_HOLD_MS = 4000;
const SPLASH_FADE_MS = 350;

const CODE_CHARS = "01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモ#%$&@";

function randomCodeColumn(rows: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    out.push(CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]!);
  }
  return out;
}

export function SplashV3({ onDone }: { onDone: () => void }) {
  const [fadingOut, setFadingOut] = useState(false);
  // Refs so a click can cancel the auto-timers and not let onDone fire twice.
  const timersRef = useRef<{ fade?: ReturnType<typeof setTimeout>; done?: ReturnType<typeof setTimeout> }>({});
  const dismissedRef = useRef(false);

  const dismiss = () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    if (timersRef.current.fade) clearTimeout(timersRef.current.fade);
    if (timersRef.current.done) clearTimeout(timersRef.current.done);
    setFadingOut(true);
    setTimeout(() => onDone(), SPLASH_FADE_MS);
  };

  useEffect(() => {
    timersRef.current.fade = setTimeout(() => {
      if (dismissedRef.current) return;
      setFadingOut(true);
    }, SPLASH_HOLD_MS);
    timersRef.current.done = setTimeout(() => {
      if (dismissedRef.current) return;
      dismissedRef.current = true;
      onDone();
    }, SPLASH_HOLD_MS + SPLASH_FADE_MS);
    return () => {
      if (timersRef.current.fade) clearTimeout(timersRef.current.fade);
      if (timersRef.current.done) clearTimeout(timersRef.current.done);
    };
  }, [onDone]);

  // Matrix rain — 28 columns, each with a randomized stream of characters
  // and a randomized fall duration / delay. Generated once per mount so the
  // animations stay stable through the 2s hold.
  const columns = useMemo(() => {
    const N = 28;
    return Array.from({ length: N }, (_, i) => {
      const durationMs = 4500 + Math.floor(Math.random() * 3000);
      // Negative animation-delay: each column appears to have already been
      // falling for a random fraction of its duration when the splash mounts.
      // So at t=0 every column is at a random vertical position — no
      // "rain hasn't started yet" pause at the top of the screen.
      const delayMs = -Math.floor(Math.random() * durationMs);
      return {
        chars: randomCodeColumn(22),
        leftPct: (i / N) * 100 + (Math.random() * 1.5 - 0.75),
        durationMs,
        delayMs,
        opacity: 0.35 + Math.random() * 0.45,
      };
    });
  }, []);

  // Constellation — 8 agent nodes on a ring around the title.
  const nodes = useMemo(() => {
    const N = 8;
    return Array.from({ length: N }, (_, i) => {
      const angle = (i / N) * Math.PI * 2;
      const radius = 180; // px from center
      return {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        delayMs: i * 90,
        durationMs: 1400 + (i % 3) * 250,
      };
    });
  }, []);

  return (
    <div
      data-id="splash-screen"
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden bg-black cursor-pointer"
      style={{
        opacity: fadingOut ? 0 : 1,
        transition: `opacity ${SPLASH_FADE_MS}ms ease-out`,
      }}
      onClick={dismiss}
      role="button"
      tabIndex={0}
      aria-label="Dismiss splash"
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") dismiss(); }}
    >
      <style>{`
        /* ─── Vignette: dim the edges so the centre pops ───────────── */
        .splash-vignette {
          position: absolute; inset: 0; pointer-events: none;
          background: radial-gradient(ellipse at center,
            rgba(0,0,0,0) 0%,
            rgba(0,0,0,0.55) 60%,
            rgba(0,0,0,0.95) 100%);
        }

        /* ─── Matrix rain ─────────────────────────────────────────── */
        .splash-rain { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
        .splash-rain-col {
          position: absolute;
          top: -50%;
          font-family: "JetBrains Mono", "Menlo", monospace;
          font-size: 13px;
          line-height: 1.05;
          color: rgba(74, 222, 128, 0.85);
          text-shadow: 0 0 6px rgba(34, 197, 94, 0.65);
          white-space: pre;
          animation: splash-rain-fall linear infinite;
          mix-blend-mode: screen;
        }
        @keyframes splash-rain-fall {
          0%   { transform: translateY(-30%); }
          100% { transform: translateY(150%); }
        }

        /* ─── Constellation core + nodes ──────────────────────────── */
        .splash-core-wrap {
          position: relative;
          width: 460px;
          height: 460px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        @keyframes splash-core-pulse {
          0%, 100% {
            box-shadow:
              0 0 24px  rgba(74, 222, 128, 0.55),
              0 0 64px  rgba(34, 197, 94, 0.35),
              0 0 128px rgba(22, 163, 74, 0.25);
            transform: translate(-50%, -50%) scale(1);
          }
          50% {
            box-shadow:
              0 0 36px  rgba(134, 239, 172, 0.85),
              0 0 96px  rgba(74, 222, 128, 0.55),
              0 0 200px rgba(34, 197, 94, 0.35);
            transform: translate(-50%, -50%) scale(1.06);
          }
        }
        .splash-core-dot {
          position: absolute;
          left: 50%; top: 50%;
          width: 14px; height: 14px;
          margin: 0;
          border-radius: 9999px;
          background: rgba(187, 247, 208, 0.95);
          animation: splash-core-pulse 1600ms ease-in-out infinite;
        }

        @keyframes splash-ring-spin {
          0%   { transform: translate(-50%, -50%) rotate(0deg); }
          100% { transform: translate(-50%, -50%) rotate(360deg); }
        }
        .splash-ring {
          position: absolute;
          left: 50%; top: 50%;
          width: 360px; height: 360px;
          border-radius: 9999px;
          border: 1px dashed rgba(74, 222, 128, 0.28);
          animation: splash-ring-spin 14s linear infinite;
        }
        .splash-ring.inner {
          width: 260px; height: 260px;
          border-style: solid;
          border-color: rgba(34, 197, 94, 0.18);
          animation-duration: 9s;
          animation-direction: reverse;
        }

        /* Agent node: small green disc with a halo and an entrance pop. */
        @keyframes splash-node-in {
          0%   { transform: translate(calc(-50% + var(--nx)), calc(-50% + var(--ny))) scale(0); opacity: 0; }
          70%  { transform: translate(calc(-50% + var(--nx)), calc(-50% + var(--ny))) scale(1.25); opacity: 1; }
          100% { transform: translate(calc(-50% + var(--nx)), calc(-50% + var(--ny))) scale(1); opacity: 1; }
        }
        @keyframes splash-node-blink {
          0%, 100% { box-shadow: 0 0 6px rgba(74, 222, 128, 0.6), 0 0 16px rgba(34, 197, 94, 0.45); }
          50%      { box-shadow: 0 0 12px rgba(134, 239, 172, 1),  0 0 28px rgba(74, 222, 128, 0.75); }
        }
        .splash-node {
          position: absolute;
          left: 50%; top: 50%;
          width: 10px; height: 10px;
          border-radius: 9999px;
          background: rgba(187, 247, 208, 0.95);
          animation:
            splash-node-in 700ms cubic-bezier(0.16, 1, 0.3, 1) both,
            splash-node-blink 1400ms ease-in-out infinite;
        }

        /* Connection lines: SVG strokes with dashoffset traveling. */
        .splash-link {
          stroke: rgba(74, 222, 128, 0.55);
          stroke-width: 1;
          stroke-dasharray: 4 10;
          filter: drop-shadow(0 0 4px rgba(34, 197, 94, 0.6));
          animation: splash-link-flow 1800ms linear infinite;
        }
        @keyframes splash-link-flow {
          0%   { stroke-dashoffset: 0;   opacity: 0.25; }
          50%  { opacity: 0.9; }
          100% { stroke-dashoffset: -140; opacity: 0.25; }
        }

        /* ─── Title with RGB glitch + green neon glow ─────────────── */
        @keyframes splash-title-in {
          0%   { opacity: 0; transform: translateY(8px) scale(0.96); letter-spacing: 0.4em; }
          60%  { opacity: 1; letter-spacing: 0.02em; }
          100% { opacity: 1; transform: translateY(0) scale(1); letter-spacing: -0.01em; }
        }
        @keyframes splash-glow-pulse {
          0%, 100% {
            text-shadow:
              0 0 6px  rgba(74, 222, 128, 0.75),
              0 0 14px rgba(34, 197, 94, 0.55),
              0 0 28px rgba(22, 163, 74, 0.40),
              0 0 56px rgba(22, 163, 74, 0.20);
          }
          50% {
            text-shadow:
              0 0 9px  rgba(134, 239, 172, 0.95),
              0 0 22px rgba(74, 222, 128, 0.75),
              0 0 44px rgba(34, 197, 94, 0.55),
              0 0 88px rgba(34, 197, 94, 0.30);
          }
        }
        @keyframes splash-glitch-rgb {
          0%, 92%, 100% { transform: translate(0,0); opacity: 0; }
          93%           { transform: translate(-2px, 1px); opacity: 0.6; }
          94%           { transform: translate(2px, -1px); opacity: 0.6; }
          95%           { transform: translate(-1px, 0); opacity: 0; }
        }
        .splash-title {
          position: relative;
          color: #bbf7d0;
          font-family: "JetBrains Mono", "Menlo", monospace;
          font-weight: 700;
          font-size: 72px;
          letter-spacing: -0.01em;
          line-height: 1;
          animation:
            splash-title-in 900ms cubic-bezier(0.16, 1, 0.3, 1) both,
            splash-glow-pulse 2200ms ease-in-out 900ms infinite;
        }
        .splash-title::before,
        .splash-title::after {
          content: "Claw";
          position: absolute; left: 0; top: 0;
          pointer-events: none;
        }
        .splash-title::before { color: #ff3860; animation: splash-glitch-rgb 4200ms infinite; mix-blend-mode: screen; }
        .splash-title::after  { color: #38f8ff; animation: splash-glitch-rgb 4200ms infinite 80ms; mix-blend-mode: screen; }

        /* Caret cursor */
        @keyframes splash-caret { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
        .splash-caret {
          display: inline-block;
          width: 14px;
          height: 64px;
          margin-left: 8px;
          background: rgba(187, 247, 208, 0.9);
          box-shadow: 0 0 10px rgba(74, 222, 128, 0.85);
          vertical-align: -10px;
          animation: splash-caret 700ms steps(1) infinite;
        }

        /* ─── Tagline: terminal-style + typewriter ────────────────── */
        /* The typewriter animates max-width from 0 to a value comfortably */
        /* wider than the rendered text so it cannot be silently clipped if */
        /* the fallback font is wider than JetBrains Mono. The visible width */
        /* is controlled by the text itself + overflow:hidden, so the cap   */
        /* just needs to be "big enough".                                   */
        @keyframes splash-tagline-type {
          0%   { max-width: 0; }
          100% { max-width: 600px; }
        }
        .splash-tagline-text {
          font-family: "JetBrains Mono", "Menlo", monospace;
          font-size: 13px;
          color: rgba(187, 247, 208, 0.85);
          letter-spacing: 0.05em;
          text-shadow: 0 0 6px rgba(74, 222, 128, 0.45);
          white-space: nowrap;
          overflow: hidden;
          border-right: 1px solid rgba(187, 247, 208, 0.9);
          max-width: 0;
          animation: splash-tagline-type 1600ms steps(41, end) 700ms forwards;
        }
        .splash-tagline-text::after {
          /* Caret blink attached to the typed text via pseudo so the type
             animation isn't competing with an opacity animation on the
             same element. */
          content: "";
          display: inline-block;
          width: 1px;
        }
        .splash-prompt-prefix {
          font-family: "JetBrains Mono", "Menlo", monospace;
          font-size: 13px;
          color: rgba(74, 222, 128, 0.95);
          text-shadow: 0 0 6px rgba(34, 197, 94, 0.55);
          margin-right: 10px;
        }

        /* ─── Bottom status bar — a scanning data line ────────────── */
        @keyframes splash-status-scan {
          0%   { transform: scaleX(0); transform-origin: left center; }
          100% { transform: scaleX(1); transform-origin: left center; }
        }
        .splash-status {
          position: absolute;
          left: 0; right: 0; bottom: 36px;
          display: flex; justify-content: center;
          font-family: "JetBrains Mono", "Menlo", monospace;
          font-size: 11px;
          letter-spacing: 0.2em;
          color: rgba(134, 239, 172, 0.7);
          text-shadow: 0 0 6px rgba(34, 197, 94, 0.5);
        }
        .splash-status::before {
          content: "";
          display: inline-block;
          width: 80px; height: 1px;
          margin-right: 12px; align-self: center;
          background: linear-gradient(to right, transparent, rgba(74, 222, 128, 0.9));
        }
        .splash-status::after {
          content: "";
          display: inline-block;
          width: 80px; height: 1px;
          margin-left: 12px; align-self: center;
          background: linear-gradient(to left, transparent, rgba(74, 222, 128, 0.9));
        }

        /* ─── Sweep line across the screen ────────────────────────── */
        @keyframes splash-sweep {
          0%   { transform: translateY(-100%); opacity: 0; }
          15%  { opacity: 0.4; }
          85%  { opacity: 0.4; }
          100% { transform: translateY(100vh); opacity: 0; }
        }
        .splash-sweep {
          position: absolute; left: 0; right: 0;
          height: 80px;
          background: linear-gradient(to bottom,
            rgba(74, 222, 128, 0) 0%,
            rgba(74, 222, 128, 0.18) 50%,
            rgba(74, 222, 128, 0) 100%);
          mix-blend-mode: screen;
          animation: splash-sweep 2200ms ease-in-out infinite;
          pointer-events: none;
        }
      `}</style>

      {/* Matrix rain */}
      <div className="splash-rain" aria-hidden="true">
        {columns.map((c, i) => (
          <div
            key={i}
            className="splash-rain-col"
            style={{
              left: `${c.leftPct}%`,
              opacity: c.opacity,
              animationDuration: `${c.durationMs}ms`,
              animationDelay: `${c.delayMs}ms`,
            }}
          >
            {c.chars.join("\n")}
          </div>
        ))}
      </div>

      {/* Sweeping scan line */}
      <div className="splash-sweep" aria-hidden="true" />

      {/* Constellation around the title */}
      <div className="splash-core-wrap">
        <div className="splash-ring inner" />
        <div className="splash-ring" />
        <div className="splash-core-dot" />

        {/* SVG link layer — center to each node */}
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="-230 -230 460 460"
          aria-hidden="true"
        >
          {nodes.map((n, i) => (
            <line
              key={i}
              x1={0}
              y1={0}
              x2={n.x}
              y2={n.y}
              className="splash-link"
              style={{ animationDelay: `${n.delayMs}ms` }}
            />
          ))}
        </svg>

        {/* Agent nodes */}
        {nodes.map((n, i) => (
          <div
            key={i}
            className="splash-node"
            style={{
              ["--nx" as never]: `${n.x}px`,
              ["--ny" as never]: `${n.y}px`,
              animationDelay: `${n.delayMs}ms, ${n.delayMs + 800}ms`,
              animationDuration: `${n.durationMs}ms, 1400ms`,
            }}
          />
        ))}

        {/* Title at the center */}
        <div className="splash-title relative z-10 select-none" data-text="Claw">
          Claw<span className="splash-caret" />
        </div>
      </div>

      {/* Tagline — terminal prompt + typewriter */}
      <div className="absolute bottom-[20%] left-0 right-0 flex justify-center z-10">
        <div className="flex items-center">
          <span className="splash-prompt-prefix">❯</span>
          <span className="splash-tagline-text">A team of agents that grow with your team</span>
        </div>
      </div>

      {/* Bottom scanning status bar */}
      <div className="splash-status" aria-hidden="true">
        INITIALIZING · AGENT · CLUSTER
      </div>

      {/* Edge vignette */}
      <div className="splash-vignette" aria-hidden="true" />
    </div>
  );
}

