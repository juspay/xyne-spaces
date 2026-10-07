import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { AssistantReasoningPart, AssistantToolPart } from '@xyne/shared';
import type { ToolInvocation } from '../utils/XyneAITypes';
import { cn } from '../../../../utils/classNames';

/**
 * Shared building blocks for the turn's step timeline (TurnTimeline), which the
 * Ask AI sidebar, the AIScreen and the Claw overlay all render — so the three
 * show the same live thinking and tool/subagent affordances and can't drift.
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

/** Whole seconds for step timings ("Thought for 4s"), minutes past a minute. */
export function formatSeconds(ms: number): string {
  return ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : formatDuration(ms);
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

// ── Turn timing ─────────────────────────────────────────────────────────────
/** The closing line of a finished turn: "Worked for 2m 31s", or "Stopped after 12s". */
export function turnDurationLabel(turn: {
  durationMs?: number | undefined;
  isAborted?: boolean | undefined;
}): string | null {
  if (turn.durationMs === undefined) return null;
  const took = formatSeconds(turn.durationMs);
  return turn.isAborted ? `Stopped after ${took}` : `Worked for ${took}`;
}

/** When a turn's answer was finished: its start plus how long it took. */
export function turnFinishedAt(turn: {
  timestamp: Date | string | number;
  durationMs?: number | undefined;
}): Date {
  return new Date(new Date(turn.timestamp).getTime() + (turn.durationMs ?? 0));
}

// ── Subagents ───────────────────────────────────────────────────────────────
/** A top-level call that ran a whole subagent. claw marks these with
 *  `subagentName`; older runs are only recognisable by the calls under them. */
export function isSubagentCall(
  invocation: ToolInvocation,
  children: ToolInvocation[] | undefined,
): boolean {
  return (
    !invocation.parentToolCallId && (!!invocation.subagentName || (children?.length ?? 0) > 0)
  );
}

/** "Spaces agent" for the `spaces` subagent. */
export function agentLabel(toolName: string): string {
  return `${humanizeToolName(toolName) || 'Sub'} agent`;
}

/** A subagent's call, named without the agent's own prefix: the Spaces
 *  agent's "Spaces Read Canvas" reads as "Read Canvas" under it. */
export function childToolLabel(child: ToolInvocation, parentToolName: string): string {
  const name = humanizeToolName(child.toolName);
  const prefix = `${humanizeToolName(parentToolName)} `;
  return name.startsWith(prefix) && name.length > prefix.length ? name.slice(prefix.length) : name;
}

// ── Step group summary ──────────────────────────────────────────────────────
export interface StepGroupSummary {
  /** e.g. "Thought for 4s, asked the Spaces agent, explored Web Search, ran Bash". */
  label: string;
  /** Calls that failed — shown after the label, so it survives truncation. */
  failed: number;
  /** Wall time from the group's first step to its last, when known. */
  durationMs: number | null;
}

/** The calls of a turn: top-level ones by id, a subagent's under its parent. */
export interface InvocationLookup {
  byId: Map<string, ToolInvocation>;
  childrenByParent: Map<string, ToolInvocation[]>;
}

const ms = (iso: string | undefined): number | null => {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
};

type StepVerb = 'asked' | 'ran' | 'explored' | 'used';

/** How a call reads in a sentence: commands are "ran", lookups "explored",
 *  anything else (writes, MCP actions) "used". Subagents are "asked". */
function verbFor(toolName: string): StepVerb {
  const base = (toolName.includes('__') ? toolName.split('__').pop()! : toolName)
    .toLowerCase()
    .replace(/-/g, '_');
  if (/^(bash|shell|sh|exec|execute|run|terminal)(_|$)/.test(base)) return 'ran';
  if (
    /^(read|grep|glob|find|ls|list|get|fetch|query|lookup|view|browse|recall)(_|$)/.test(base) ||
    /(^|_)(search|fetch|lookup)(_|$)/.test(base)
  ) {
    return 'explored';
  }
  return 'used';
}

/** "A", "A and B", "A, B and C", "A, B and 3 more". */
function nameList(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/**
 * One sentence naming what a run of thinking + tool calls did — the collapsed
 * header of a step group, e.g. "Thought for 4s, asked the Spaces agent, explored
 * Web Search, ran Bash". Each tool is named once however often it ran.
 */
export function summarizeSteps(
  parts: Array<AssistantReasoningPart | AssistantToolPart>,
  calls: InvocationLookup,
): StepGroupSummary {
  let thinkingMs = 0;
  let thought = false;
  let start = Infinity;
  let end = -Infinity;
  let failed = 0;
  const clauses = new Map<StepVerb, string[]>();
  for (const part of parts) {
    if (part.type === 'reasoning') {
      thought = true;
      const from = ms(part.startedAt);
      const to = ms(part.endedAt);
      if (from !== null) start = Math.min(start, from);
      if (to !== null) end = Math.max(end, to);
      if (from !== null && to !== null && to > from) thinkingMs += to - from;
      continue;
    }
    const invocation = calls.byId.get(part.id);
    if (!invocation) continue;
    const subagent = isSubagentCall(invocation, calls.childrenByParent.get(part.id));
    const verb = subagent ? 'asked' : verbFor(invocation.toolName);
    const names = clauses.get(verb) ?? [];
    const name = humanizeToolName(invocation.toolName) || 'a tool';
    if (!names.includes(name)) names.push(name);
    clauses.set(verb, names);
    if (invocation.isError || invocation.status === 'error') failed += 1;
    const from = ms(invocation.startedAt);
    if (from !== null) {
      start = Math.min(start, from);
      end = Math.max(end, from + (invocation.durationMs || 0));
    }
  }
  const sentence = [
    thinkingMs >= 1000 ? `thought for ${formatSeconds(thinkingMs)}` : thought ? 'thought' : null,
    ...[...clauses].map(([verb, names]) =>
      verb === 'asked'
        ? `asked the ${nameList(names)} ${names.length > 1 ? 'agents' : 'agent'}`
        : `${verb} ${nameList(names)}`,
    ),
  ]
    .filter(Boolean)
    .join(', ');
  return {
    label: sentence ? sentence.charAt(0).toUpperCase() + sentence.slice(1) : 'Steps',
    failed,
    durationMs: Number.isFinite(start) && end > start ? end - start : null,
  };
}

/** Height + fade reveal that never snaps. The content mounts on first open
 *  and stays mounted, so closing animates too. */
export function Reveal({
  open,
  id,
  children,
}: {
  open: boolean;
  id?: string;
  children: ReactNode;
}): ReactElement {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return (
    <div
      id={id}
      // Collapsed content is out of the tab order and hidden from assistive tech.
      inert={!open}
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none',
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      )}
    >
      <div className='min-h-0 overflow-hidden'>{opened && children}</div>
    </div>
  );
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
  // that collapses this pane on completion (TurnTimeline's grid-rows transition)
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
