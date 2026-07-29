import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { Loader2, Clock } from 'lucide-react';
import type { ToolInvocation } from '../utils/XyneAITypes';

/**
 * Shared building blocks for the live "activity" surface used by BOTH the Ask AI
 * sidebar (ActivityBlock) and the AIScreen (ReasoningSection). Extracted so the
 * two surfaces render the same live thinking + tool/subagent affordances and
 * can't drift. Everything here is driven purely by data that already streams
 * (message.reasoning grows char-by-char; message.toolInvocations upsert live) —
 * no backend or type changes.
 */

// ── Duration formatting ─────────────────────────────────────────────────────
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSecs = ms / 1000;
  if (totalSecs < 60) {
    return totalSecs < 10 ? `${totalSecs.toFixed(1)}s` : `${Math.round(totalSecs)}s`;
  }
  const mins = Math.floor(totalSecs / 60);
  const secs = Math.round(totalSecs - mins * 60);
  return `${mins}m ${secs}s`;
}

/**
 * Live wall-clock elapsed for a streaming turn. Captures the start on the first
 * render where `active` is true, ticks every 250ms, and freezes the final value
 * when `active` flips false so the user sees total thinking time. Returns null
 * for history-loaded messages never seen active.
 */
export function useElapsedMs(active: boolean): number | null {
  const startRef = useRef<number | null>(null);
  const finalRef = useRef<number | null>(null);
  const [, force] = useState(0);

  if (active && startRef.current === null) {
    startRef.current = Date.now();
  }

  useEffect(() => {
    if (!active) {
      if (startRef.current !== null && finalRef.current === null) {
        finalRef.current = Date.now() - startRef.current;
      }
      return;
    }
    const id = window.setInterval(() => force(n => n + 1), 250);
    return (): void => window.clearInterval(id);
  }, [active]);

  if (active && startRef.current !== null) {
    return Date.now() - startRef.current;
  }
  return finalRef.current;
}

/** Top + bottom fade mask so scrollable content dissolves into the column. */
export const FADE_MASK_STYLE: CSSProperties = {
  WebkitMaskImage:
    'linear-gradient(to bottom, transparent 0, black 14px, black calc(100% - 14px), transparent 100%)',
  maskImage:
    'linear-gradient(to bottom, transparent 0, black 14px, black calc(100% - 14px), transparent 100%)',
};

/** Strip the MCP server prefix / provider suffix and title-case a raw tool id. */
export function humanizeToolName(raw: string | undefined): string {
  if (!raw) return '';
  const stripped = raw.includes('__') ? raw.split('__').slice(1).join('__') : raw;
  const trimmed = stripped.includes(':') ? stripped.split(':').slice(-1)[0]! : stripped;
  return trimmed
    .split(/[-_]/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// ── Activity accent (monochrome) ────────────────────────────────────────────
// Fully gray: subagents, spinners, and running/background work all read in
// neutral tones. The ONLY color accents live directly on their icons — a green
// check for success and a faint red for errors — so the tree stays calm and
// modern. Subagents are told apart by a hairline group box (see
// ToolInvocationList), not a hue. Centralized so the palette retunes in one place.
export const activityAccent = {
  text: 'text-muted-foreground',
  soft: 'text-muted-foreground/70',
  chip: 'bg-muted text-muted-foreground',
  // Gray hairline group box for subagents — border only, no background fill.
  card: 'border-border',
  dot: 'bg-muted-foreground/50',
  bgChip: 'bg-muted text-muted-foreground',
} as const;

// ── Smooth numeric tween ────────────────────────────────────────────────────
// Eases a displayed number toward its target so counters glide instead of
// snapping. Snaps within 1 to avoid a lingering fractional tail. Self-stops.
export function useSmoothCount(target: number): number {
  const curRef = useRef(target);
  const [shown, setShown] = useState(target);
  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      const c = curRef.current;
      if (Math.abs(target - c) < 1) {
        if (c !== target) {
          curRef.current = target;
          setShown(target);
        }
        return;
      }
      curRef.current = c + (target - c) * 0.18;
      setShown(Math.round(curRef.current));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

/** Compact char count: 812 → "812", 1240 → "1.2k", 12400 → "12k". */
export function formatCount(n: number): string {
  return n < 1000 ? `${n}` : `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`;
}

/** Soft top fade so older reasoning dissolves as it scrolls up; the newest text
 *  stays crisp at the bottom so its per-chunk fade-in reads clearly. */
const PANE_FADE: CSSProperties = {
  WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 16px, black 100%)',
  maskImage: 'linear-gradient(to bottom, transparent 0, black 16px, black 100%)',
};

// ── Live reasoning: a bounded auto-scroll window of the model's real thinking ─
export function LiveReasoning({
  reasoning,
  lines = 3,
}: {
  reasoning: string;
  /** Kept for caller compatibility; the pane now renders whenever `reasoning`
   *  is non-empty and the parent controls show/hide (collapse). */
  streaming?: boolean;
  /** Visible height in text lines (sidebar = 3, AIScreen = 5). */
  lines?: number;
}): ReactElement | null {
  const paneRef = useRef<HTMLDivElement>(null);
  const stuckToBottom = useRef(true);
  // Track the previous reasoning so we can fade in ONLY the newly-arrived chunk.
  const prevRef = useRef('');
  const prev = prevRef.current;
  useEffect(() => {
    prevRef.current = reasoning;
  });

  // Keep the newest text in view via NATIVE smooth scroll (scrollTo + behavior:
  // 'smooth'): the browser GPU-animates the glide, so there is NO per-frame JS.
  // Fires only when `reasoning` changes (per delta), not per animation frame.
  useEffect(() => {
    const el = paneRef.current;
    if (el && stuckToBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [reasoning]);

  // Render whenever there's reasoning — even after streaming ends — so a parent
  // that collapses this pane on completion (ActivityBlock's grid-rows transition)
  // animates the text shrinking away instead of it vanishing first. Callers that
  // must hide it post-stream gate on their own isStreaming (AIScreen does).
  if (!reasoning.trim()) return null;

  // Split into settled text (already shown, static) + the just-arrived chunk,
  // and fade in ONLY the chunk (CSS opacity keyframe) — the Claude-style
  // "type-in fade" at the writing edge, with zero per-frame JS. Re-keyed by
  // length so each new chunk re-triggers its fade.
  const grew = reasoning.startsWith(prev) && reasoning.length > prev.length;
  const settled = grew ? prev : reasoning;
  const fresh = grew ? reasoning.slice(prev.length) : '';

  return (
    <div
      ref={paneRef}
      onScroll={e => {
        const el = e.currentTarget;
        stuckToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 28;
      }}
      className='animate-fade-in-up overflow-y-auto whitespace-pre-wrap break-words text-[11px] italic leading-relaxed text-muted-foreground/70 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
      style={{ maxHeight: `${(lines * 1.7).toFixed(2)}em`, ...PANE_FADE }}
    >
      {settled}
      {fresh && (
        <span key={reasoning.length} className='token-fade'>
          {fresh}
        </span>
      )}
    </div>
  );
}

// ── Consolidated live status chip ────────────────────────────────────────────
/**
 * ONE fixed-footprint chip summarizing all currently-active work:
 * "⟳ 2 running · ⧗ 5 bg". Replaces the old per-tool chip strip + separate
 * background pill, which grew horizontally with every parallel call and made
 * the header jump as chips came and went. Counts tween (useSmoothCount) so
 * changes glide in place; per-tool detail lives in the expanded
 * ToolInvocationList. Self-hides when nothing is active — including AFTER the
 * answer completes, so still-running detached background work stays visible.
 */
export function ActivityStatusChip({
  toolInvocations,
}: {
  toolInvocations?: ToolInvocation[] | undefined;
}): ReactElement | null {
  const { running, background } = useMemo(() => {
    const invs = toolInvocations ?? [];
    let running = 0;
    let background = 0;
    for (const inv of invs) {
      if (inv.parentToolCallId) continue; // roots only — children live in the expanded list
      if (inv.background === true && inv.backgroundState === 'running') background++;
      else if (inv.status === 'running') running++;
    }
    return { running, background };
  }, [toolInvocations]);

  const smoothRunning = useSmoothCount(running);
  const smoothBackground = useSmoothCount(background);

  if (running + background === 0) return null;

  return (
    <span
      className={`animate-fade-in-up inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] tabular-nums ${activityAccent.bgChip}`}
    >
      {running > 0 && (
        <span className='inline-flex items-center gap-1'>
          <Loader2 size={9} className={`shrink-0 animate-spin ${activityAccent.text}`} />
          {smoothRunning} running
        </span>
      )}
      {running > 0 && background > 0 && <span className='opacity-50'>·</span>}
      {background > 0 && (
        <span className='inline-flex items-center gap-1'>
          <Clock size={9} className='shrink-0 animate-pulse' />
          {smoothBackground} background
        </span>
      )}
    </span>
  );
}
