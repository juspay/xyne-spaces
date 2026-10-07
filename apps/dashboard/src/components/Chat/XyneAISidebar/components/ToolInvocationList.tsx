import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { AlertCircle, Bot, ChevronRight, Link2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ToolInvocation, ClawCitation } from '../utils/XyneAITypes';
import { buildClawCitationUrl, getClawCitationLabel } from '../utils/clawCitationUrl';
import { cn } from '../../../../utils/classNames';
import {
  agentLabel,
  childToolLabel,
  formatDuration,
  humanizeToolName,
  isSubagentCall,
  Reveal,
} from './activityShared';

export interface InvocationTree {
  roots: ToolInvocation[];
  /** Top-level calls by toolCallId. */
  byId: Map<string, ToolInvocation>;
  /** A subagent's calls, under the call that spawned it. */
  childrenByParent: Map<string, ToolInvocation[]>;
}

/**
 * A message's tool calls as a tree. When the message was stopped mid-run, a
 * call still marked running never got its end frame — it is shown as
 * cancelled rather than as a perpetual spinner (children inherit this).
 */
export function groupInvocations(
  invocations: ToolInvocation[],
  messageAborted = false,
): InvocationTree {
  const roots: ToolInvocation[] = [];
  const byId = new Map<string, ToolInvocation>();
  const childrenByParent = new Map<string, ToolInvocation[]>();
  for (const raw of invocations) {
    const inv =
      messageAborted &&
      (raw.status === 'running' || (raw.background && raw.backgroundState === 'running'))
        ? { ...raw, status: 'cancelled' as const }
        : raw;
    if (inv.parentToolCallId) {
      const list = childrenByParent.get(inv.parentToolCallId) ?? [];
      list.push(inv);
      childrenByParent.set(inv.parentToolCallId, list);
    } else {
      roots.push(inv);
      if (inv.toolCallId) byId.set(inv.toolCallId, inv);
    }
  }
  return { roots, byId, childrenByParent };
}

interface InvocationItemProps {
  invocation: ToolInvocation;
  /** A subagent's own calls, listed under it when it is opened. */
  children?: ToolInvocation[] | undefined;
  /** One of a subagent's calls: a tighter row under its parent. */
  nested?: boolean;
}

interface CitationListProps {
  citations: ClawCitation[];
}

function CitationList({ citations }: CitationListProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const MAX_VISIBLE = 3;
  const hasOverflow = citations.length > MAX_VISIBLE;

  return (
    <div>
      <button
        onClick={() => hasOverflow && setExpanded(!expanded)}
        className={cn(
          'mb-0.5 flex w-full items-center justify-between text-[11px] text-muted-foreground/70',
          hasOverflow && 'cursor-pointer hover:text-foreground',
        )}
        type='button'
        data-track-category='XyneAI'
        data-track-name='toggle-citations-expand'
      >
        <span>Sources ({citations.length})</span>
        {hasOverflow && <span>{expanded ? 'Show less' : `Show all ${citations.length}`}</span>}
      </button>
      <ul className={cn('space-y-0.5', expanded && 'max-h-48 overflow-y-auto pr-1')}>
        {(expanded ? citations : citations.slice(0, MAX_VISIBLE)).map((citation, idx) => {
          const url = buildClawCitationUrl(citation);
          const label = getClawCitationLabel(citation);

          return (
            <li key={idx} className='flex items-start gap-1.5 text-[11px] leading-[18px]'>
              <Link2 aria-hidden className='mt-[3px] size-3 shrink-0 text-muted-foreground/50' />
              {url ? (
                <Link
                  to={url}
                  className='break-all text-blue-500 hover:text-blue-600 hover:underline'
                  onClick={e => e.stopPropagation()}
                  data-track-category='XyneAI'
                  data-track-name='open-citation-link'
                >
                  {label}
                </Link>
              ) : (
                <span className='break-all text-muted-foreground'>{label}</span>
              )}
            </li>
          );
        })}
        {!expanded && hasOverflow && (
          <li className='pl-[18px] text-[11px] text-muted-foreground/50'>
            +{citations.length - MAX_VISIBLE} more
          </li>
        )}
      </ul>
    </div>
  );
}

/** Arguments that say what a call is about, most telling first; the first one
 *  present is shown beside the tool's name. */
const PREVIEW_KEYS = [
  'description',
  'question',
  'query',
  'title',
  'path',
  'file_path',
  'url',
  'command',
  'pattern',
  'prompt',
];

function previewOf(args: Record<string, unknown>): { key: string; text: string } | null {
  for (const key of PREVIEW_KEYS) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return { key, text: value.trim() };
  }
  return null;
}

/** A result as text a person reads: MCP tools wrap theirs in a
 *  `{"content":[{"type":"text","text":…}]}` envelope, which is unwrapped. */
function readableResult(result: string): string {
  if (!result.trimStart().startsWith('{"content"')) return result;
  try {
    const parsed = JSON.parse(result) as { content?: Array<{ type?: string; text?: unknown }> };
    const texts = (parsed.content ?? [])
      .filter(block => block.type === 'text' && typeof block.text === 'string')
      .map(block => block.text as string);
    return texts.length > 0 ? texts.join('\n\n') : result;
  } catch {
    return result;
  }
}

/** Only rendered once its row is opened, so results are parsed on demand. */
function ToolResult({
  result,
  prose,
  failed,
}: {
  result: string | undefined;
  /** A subagent's answer reads as prose, not as output. */
  prose: boolean;
  failed: boolean;
}): ReactElement {
  const text = useMemo(() => (result ? readableResult(result) : ''), [result]);
  return (
    <pre
      className={cn(
        'max-h-64 overflow-auto whitespace-pre-wrap break-words',
        prose ? 'font-sans text-xs leading-5' : 'font-mono text-[11px] leading-[18px]',
        failed ? 'text-red-500/90' : 'text-muted-foreground/80',
      )}
    >
      {text || 'No output'}
    </pre>
  );
}

/** A subagent's calls shown at once; earlier ones fold behind "Show N earlier". */
const VISIBLE_SUBAGENT_CALLS = 8;

/**
 * One tool call as a quiet row: its name, what it was about, and — right after
 * them — an alert when it failed and the chevron. Success needs no mark; a
 * running call's name shimmers. Opening it shows the arguments it was not
 * already summarised by, its result and its sources.
 *
 * A subagent reads as an agent, not a tool: "Spaces agent", its question and
 * how many calls it has made, with what it is doing right now while it runs.
 * Opened, it lists its calls under a thin guide line, then its answer.
 */
export function InvocationItem({
  invocation,
  children,
  nested = false,
}: InvocationItemProps): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [showAllCalls, setShowAllCalls] = useState(false);

  const subCalls = children ?? [];
  const isSubagent = isSubagentCall(invocation, children);
  const isRunning = invocation.status === 'running';
  const isCancelled = invocation.status === 'cancelled';
  // A subagent spawned with run_in_background: the wrapper tool call returned
  // immediately (status='completed'), so its live state lives in backgroundState.
  const isBackground = invocation.background === true;
  const isBackgroundRunning =
    isBackground && invocation.backgroundState === 'running' && !isCancelled;
  const working = isRunning || isBackgroundRunning;
  const failed =
    !!invocation.isError ||
    invocation.status === 'error' ||
    invocation.backgroundState === 'error';
  const args = invocation.args ?? {};
  const preview = previewOf(args);
  // What a busy subagent is doing right now, so it reads as busy while closed.
  const runningChild = working
    ? subCalls.filter(child => child.status === 'running').at(-1)
    : undefined;
  const detail =
    runningChild && !expanded
      ? `${childToolLabel(runningChild, invocation.toolName)}…`
      : (preview?.text ?? null);
  const note = isCancelled
    ? 'stopped'
    : isBackgroundRunning
      ? 'running in background'
      : isBackground
        ? 'background'
        : null;
  const showArgs = Object.keys(args).some(key => key !== preview?.key);
  const showDuration = !working && !isCancelled;
  const hiddenCalls = showAllCalls ? 0 : Math.max(0, subCalls.length - VISIBLE_SUBAGENT_CALLS);
  const iconClass = nested ? 'mt-1 size-3' : 'mt-[3px] size-3.5';

  return (
    <div className='min-w-0'>
      <button
        type='button'
        onClick={() => setExpanded(value => !value)}
        aria-expanded={expanded}
        className={cn(
          'group/row flex w-full items-start gap-2 text-left leading-5 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none',
          nested ? 'rounded-md px-2 py-0.5 text-xs' : 'px-3 py-1 text-[13px]',
        )}
        data-track-category='XyneAI'
        data-track-name='toggle-tool-invocation'
      >
        <span className='flex min-w-0 items-start gap-1.5'>
          {isSubagent && (
            <Bot aria-hidden className={cn('shrink-0 text-muted-foreground/70', iconClass)} />
          )}
          <span
            className={cn(
              'shrink-0',
              isSubagent ? 'text-muted-foreground' : 'text-muted-foreground/70',
              working && 'typing-shimmer',
            )}
          >
            {isSubagent
              ? agentLabel(invocation.toolName)
              : nested
                ? childToolLabel(invocation, invocation.subagentName ?? '')
                : humanizeToolName(invocation.toolName) || 'Tool'}
          </span>
          {detail && (
            <span
              className={cn(
                'min-w-0 break-words',
                runningChild && !expanded ? 'text-muted-foreground/60' : 'text-muted-foreground',
                preview?.key === 'command' && 'font-mono text-[0.92em]',
                !expanded && 'truncate',
              )}
            >
              {detail}
            </span>
          )}
          {isSubagent && subCalls.length > 0 && (
            <span className='shrink-0 tabular-nums text-muted-foreground/50'>
              {subCalls.length} {subCalls.length === 1 ? 'call' : 'calls'}
            </span>
          )}
          {note && <span className='shrink-0 text-muted-foreground/50'>{note}</span>}
          {failed && (
            <AlertCircle
              role='img'
              aria-label='Failed'
              className={cn('shrink-0 text-red-500/90', iconClass)}
            />
          )}
          <ChevronRight
            aria-hidden
            className={cn(
              'shrink-0 text-muted-foreground/50 transition-transform duration-200 motion-reduce:transition-none',
              iconClass,
              expanded && 'rotate-90',
            )}
          />
        </span>
        {showDuration && (
          <span
            className={cn(
              'ml-auto shrink-0 pl-2 text-[11px] tabular-nums text-muted-foreground/50 transition-opacity group-hover/row:opacity-100',
              !expanded && 'opacity-0',
            )}
          >
            {formatDuration(invocation.durationMs)}
          </span>
        )}
      </button>

      <Reveal open={expanded}>
        <div className={cn('space-y-1.5 pb-2 pt-0.5', nested ? 'px-2' : 'px-3')}>
          {showArgs && (
            <pre className='max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/50 px-2.5 py-1.5 font-mono text-[11px] leading-[18px] text-muted-foreground/80'>
              {JSON.stringify(args, null, 2)}
            </pre>
          )}

          {subCalls.length > 0 && (
            <div className='ml-0.5 border-l border-border/60 pl-1.5'>
              {hiddenCalls > 0 && (
                <button
                  type='button'
                  onClick={() => setShowAllCalls(true)}
                  className='rounded-md px-2 py-0.5 text-xs leading-5 text-muted-foreground/60 transition-colors hover:text-foreground'
                  data-track-category='XyneAI'
                  data-track-name='show-all-subagent-calls'
                >
                  Show {hiddenCalls} earlier {hiddenCalls === 1 ? 'call' : 'calls'}
                </button>
              )}
              <ul>
                {subCalls.slice(hiddenCalls).map((child, i) => (
                  <li
                    key={child.toolCallId ?? `${child.toolName}-${i}`}
                    className='duration-200 animate-in fade-in-0 motion-reduce:animate-none'
                  >
                    <InvocationItem invocation={child} nested />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isCancelled ? (
            <p className='text-xs italic text-muted-foreground/60'>Stopped before it finished</p>
          ) : (
            !working && (
              <ToolResult result={invocation.result} prose={isSubagent} failed={failed} />
            )
          )}

          {invocation.citations && invocation.citations.length > 0 && (
            <CitationList citations={invocation.citations} />
          )}
        </div>
      </Reveal>
    </div>
  );
}
