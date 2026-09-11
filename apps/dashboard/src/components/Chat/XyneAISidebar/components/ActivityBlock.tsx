import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ToolInvocation } from '../utils/XyneAITypes';
import { ToolInvocationList } from './ToolInvocationList';
import { ActivityStatusChip, LiveReasoning, useSmoothCount, formatCount } from './activityShared';

/**
 * 8-bit cycle loader — a horizontal strip of small pixel cells with one cell
 * "lit" at a time, advancing and wrapping. Inlined here because it's only
 * used by ActivityBlock's header; a separate file would just be indirection.
 * Cells inherit `text-foreground` so it picks up the theme.
 */
function EightBitLoader({
  cells = 5,
  intervalMs = 150,
}: {
  cells?: number;
  intervalMs?: number;
} = {}): ReactElement {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      setIndex(i => (i + 1) % cells);
    }, intervalMs);
    return (): void => window.clearInterval(id);
  }, [cells, intervalMs]);

  return (
    <span
      role='img'
      aria-label='loading'
      className='inline-flex items-center gap-[1.5px] text-foreground'
    >
      {Array.from({ length: cells }, (_, i) => (
        <span
          key={i}
          aria-hidden='true'
          // 4×4 px pixel — rounded just enough to soften edges without losing
          // the 8-bit feel. 100ms opacity transition so the lit cell
          // crossfades to the next instead of snapping.
          className={`block h-[4px] w-[4px] rounded-[1px] bg-current transition-opacity duration-100 ${
            i === index ? 'opacity-90' : 'opacity-20'
          }`}
        />
      ))}
    </span>
  );
}

interface ActivityBlockProps {
  /** Raw reasoning text from the agent (v2 `reasoning` field). */
  reasoning?: string | undefined;
  /** Tool calls made during this assistant turn. */
  toolInvocations?: ToolInvocation[] | undefined;
  /** True while the assistant message is still streaming. */
  streaming?: boolean | undefined;
  /** True if the parent message was aborted mid-stream — forwarded to ToolInvocationList. */
  messageAborted?: boolean | undefined;
  /**
   * Render to fill its container (e.g. the Support reasoning panel) instead of
   * a compact chat-bubble block: starts expanded and drops the fixed
   * `max-h-[28rem]` cap so the parent scrolls the whole reasoning + tool tree.
   */
  fillHeight?: boolean | undefined;
}

/**
 * Pool of thinking phrases. One is picked at random per assistant turn (when
 * the ActivityBlock mounts) and held for the whole streaming duration —
 * rotating the phrase mid-turn looked twitchy on short responses, so we lock
 * it in. A new random phrase shows up on the next message because that's a
 * fresh component mount.
 *
 * Short and varied; modeled after Claude Code's status line.
 */
const THINKING_PHRASES = [
  'Thinking',
  'Looking around',
  'Pulling context',
  'Connecting the dots',
  'Sifting evidence',
  'Reasoning',
] as const;

/**
 * Pick one random thinking phrase and hold it for the lifetime of the
 * component. `useState`'s lazy initializer runs exactly once per mount, so
 * re-renders while streaming don't re-roll the phrase — only a fresh
 * assistant turn (new mount) gets a new word.
 */
function useTurnPhrase(): string {
  const [phrase] = useState<string>(
    () => THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)]!,
  );
  return phrase;
}

function formatDuration(ms: number): string {
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
 * Tick once the assistant starts streaming so the header shows a live
 * elapsed counter ("0.4s", "1.2s", …). The start timestamp is captured on
 * the *first* render where `active` is true and kept in a ref — it does not
 * reset on subsequent re-renders. When `active` flips back to false the
 * final elapsed value is frozen and returned as-is so the user sees the
 * total thinking time after completion.
 *
 * Returns `null` when never seen-active in this session (history-loaded
 * messages) — callers fall back to whatever duration the data carries.
 */
function useElapsedMs(active: boolean): number | null {
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

/**
 * Top + bottom fade mask for the expanded content area. Makes the block bleed
 * into the surrounding message column instead of ending in a hard edge.
 */
const FADE_MASK_STYLE: CSSProperties = {
  WebkitMaskImage:
    'linear-gradient(to bottom, transparent 0, black 14px, black calc(100% - 14px), transparent 100%)',
  maskImage:
    'linear-gradient(to bottom, transparent 0, black 14px, black calc(100% - 14px), transparent 100%)',
};

/**
 * Combined "thinking + tool calls" panel for the Ask AI sidebar.
 *
 * Renders as a borderless, transparent inline block — no card, no gray box —
 * so it sits naturally in the message column. Default state is collapsed:
 * just a single header line with a smooth shimmer + rotating phrase while
 * streaming, or a chevron + "Thought process · N tools · 1.2s" when done.
 *
 * When the assistant is actually running a tool, a small second line appears
 * below the phrase ("↳ Calling Spaces Tickets") so the user sees concrete
 * progress without expanding.
 *
 * Expanding the block reveals reasoning text + the full ToolInvocationList.
 * The expanded body is wrapped in a top/bottom fade mask so its edges
 * dissolve into the surrounding column instead of looking boxed in.
 *
 * Renders even before reasoning/tools arrive (as long as `streaming` is true)
 * so it serves as the *single* loading indicator for the assistant — the
 * legacy bouncing-dots row in MessageItem is removed in favor of this one.
 */
export function ActivityBlock({
  reasoning,
  toolInvocations,
  streaming,
  messageAborted,
  fillHeight = false,
}: ActivityBlockProps): ReactElement {
  const hasReasoning = !!reasoning && reasoning.length > 0;
  const hasTools = !!toolInvocations && toolInvocations.length > 0;

  // Collapsed by default in a chat bubble — the user opens it explicitly. In
  // fillHeight mode (a dedicated panel) it starts open so the panel isn't empty.
  const [expanded, setExpanded] = useState(fillHeight);

  const completedToolCount = useMemo(
    () => (toolInvocations ?? []).filter(t => !t.parentToolCallId).length,
    [toolInvocations],
  );
  const elapsedMs = useElapsedMs(!!streaming);
  const toolDurationSumMs = useMemo(
    () => (toolInvocations ?? []).reduce((acc, t) => acc + (t.durationMs || 0), 0),
    [toolInvocations],
  );
  const displayedDurationMs = elapsedMs ?? toolDurationSumMs;

  // Tool count tweens on the rare +1; the char count updates per delta (no
  // per-frame tween) — keeps streaming cheap.
  const smoothTools = useSmoothCount(completedToolCount);

  // One phrase per turn — picked at mount, never changes mid-stream. The
  // concrete "Calling X" tool subtext below carries the live progress; the
  // top line just sets the vibe.
  const phrase = useTurnPhrase();
  const mainLine = streaming ? `${phrase}…` : 'Thought process';

  // Whether the block has anything to show. Silent on user turns and on
  // completed bot messages with no reasoning + no tools.
  const shouldShow = !!streaming || hasReasoning || hasTools;

  // Right-side summary. Streaming: live char counter + tool count + elapsed.
  // Done: tool count + total duration. Counts are tweened (smoothChars/Tools).
  const summaryBits: string[] = [];
  if (streaming && (reasoning?.length ?? 0) > 0)
    summaryBits.push(`${formatCount(reasoning?.length ?? 0)} chars`);
  if (hasTools) summaryBits.push(`${smoothTools} tool${smoothTools === 1 ? '' : 's'}`);
  if (displayedDurationMs > 0) summaryBits.push(formatDuration(displayedDurationMs));

  const canExpand = hasReasoning || hasTools;

  return (
    // Whole-block collapse. With the stable render key the bubble no longer
    // remounts on completion, so this grid-rows(1fr↔0fr)+opacity transition
    // actually animates: on a pure-text answer `shouldShow` flips false and the
    // block eases out instead of snapping. Kept mounted (collapsed to 0 height)
    // when hidden; CSS only animates on change, so a message that starts hidden
    // (history) renders collapsed with no motion. Padding is on the inner div so
    // it collapses with the height.
    <div
      className={`grid ${shouldShow ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
      style={{ transition: 'grid-template-rows 220ms ease-out, opacity 180ms ease-out' }}
    >
      <div className='overflow-hidden'>
        {/* Leading pt kept from when this aligned with the (now removed)
            assistant logo — it still sets the block's top spacing. */}
        <div className='pb-1 pt-2.5'>
          <button
            type='button'
            onClick={() => canExpand && setExpanded(e => !e)}
            className={`flex w-full items-center gap-2 text-left transition-colors ${
              canExpand ? 'cursor-pointer hover:text-foreground' : 'cursor-default'
            }`}
            data-track-category='XyneAI'
            data-track-name='toggle-activity-block'
            aria-expanded={expanded}
            disabled={!canExpand}
          >
            {/* Indicator: 8-bit cycle while live, chevron once done. Keyed on
            streaming so the swap crossfades (fade-in) in place instead of
            snapping when the run completes. */}
            <span
              key={streaming ? 'live' : 'done'}
              className='inline-flex shrink-0 animate-fade-in'
            >
              {streaming ? (
                <EightBitLoader />
              ) : (
                <ChevronRight
                  size={14}
                  className={`text-muted-foreground transition-transform duration-200 ${
                    expanded ? 'rotate-90' : ''
                  }`}
                />
              )}
            </span>

            <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
              {/* Top line: phrase / "Thought process" + summary metadata. */}
              <span className='flex items-center gap-1.5'>
                {/* Color eases via transition-colors; the label text itself
                crossfades (keyed on streaming) so "Thinking…" → "Thought
                process" fades rather than snapping. */}
                <span
                  className={`text-xs transition-colors duration-300 ${streaming ? 'text-foreground/80' : 'text-muted-foreground'}`}
                >
                  <span key={streaming ? 'live' : 'done'} className='inline-block animate-fade-in'>
                    {mainLine}
                  </span>
                </span>
                {summaryBits.length > 0 && (
                  <span
                    key={streaming ? 'live' : 'done'}
                    className='animate-fade-in text-[10px] tabular-nums text-muted-foreground/70'
                  >
                    · {summaryBits.join(' · ')}
                  </span>
                )}
                {/* ONE consolidated status chip ("⟳ 2 running · ⧗ 5 bg") — fixed
                footprint, tweened counts, so the header never grows or jumps
                as parallel calls come and go. Not gated on `streaming`: it
                keeps showing detached background work after the answer lands. */}
                <ActivityStatusChip toolInvocations={toolInvocations} />
              </span>
            </span>
          </button>

          {/* Live reasoning pane — collapses out (grid-rows + opacity) when
          streaming ends instead of unmounting abruptly. Kept mounted while
          collapsed so the exit transitions. */}
          <div
            className={`grid ${streaming ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
            style={{ transition: 'grid-template-rows 220ms ease-out, opacity 180ms ease-out' }}
          >
            <div className='overflow-hidden'>
              <div className='mt-0.5 pl-6' aria-live='polite'>
                <LiveReasoning reasoning={reasoning ?? ''} streaming={!!streaming} lines={3} />
              </div>
            </div>
          </div>

          {/* Smooth height transition on expand/collapse via the grid-rows 0fr→1fr
          trick — quick (200ms), never snaps. Content stays mounted. */}
          {canExpand && (
            <div
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
              }`}
            >
              <div className='overflow-hidden'>
                <div
                  className={
                    fillHeight
                      ? 'mt-1.5 pl-5 pr-0.5 py-2 space-y-3'
                      : 'mt-1.5 max-h-[28rem] overflow-y-auto pl-5 pr-0.5 py-2 space-y-3'
                  }
                  style={fillHeight ? undefined : FADE_MASK_STYLE}
                >
                  {hasReasoning && (
                    <div>
                      <div className='mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70'>
                        Reasoning
                      </div>
                      <pre className='whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground'>
                        {reasoning}
                      </pre>
                    </div>
                  )}

                  {hasTools && (
                    <div>
                      {hasReasoning && (
                        <div className='mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70'>
                          Tool calls
                        </div>
                      )}
                      <ToolInvocationList
                        invocations={toolInvocations}
                        messageAborted={messageAborted}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
