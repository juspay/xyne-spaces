import { Fragment, useId, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  groupTurnParts,
  legacyParts,
  type AssistantPart,
  type AssistantReasoningPart,
  type AssistantToolPart,
} from '@xyne/shared';
import type { Message, ToolInvocation } from '../utils/XyneAITypes';
import { cn } from '../../../../utils/classNames';
import { useStableLabel } from '../../../AIScreen/ReasoningLoader';
import { groupInvocations, InvocationItem, type InvocationTree } from './ToolInvocationList';
import {
  agentLabel,
  childToolLabel,
  formatSeconds,
  humanizeToolName,
  isSubagentCall,
  LiveReasoning,
  Reveal,
  summarizeSteps,
  useElapsedMs,
} from './activityShared';

/**
 * An assistant turn the way the agent produced it, in order: its thinking,
 * what it said, the tools it ran, more thinking, … and its answer. Text reads
 * inline; each run of thinking + tool calls between two texts folds into one
 * step group ("Thought for 4s, explored Search Tickets ›") that expands to a row
 * per step — the pattern Claude and Codex use, so the agent's progress is
 * visible without burying the answer.
 *
 * Shared by the AI screen, the Ask AI sidebar and the Claw overlay. Each
 * surface renders text its own way (markdown, citations) via `renderText`.
 */

export interface TurnTextState {
  /** This text is still being written. */
  streaming: boolean;
}

type TurnMessage = Pick<
  Message,
  'parts' | 'reasoning' | 'toolInvocations' | 'isStreaming' | 'isAborted' | 'statusMessage'
>;

interface TurnTimelineProps {
  message: TurnMessage;
  renderText: (text: string, state: TurnTextState) => ReactNode;
  /** A message saved before ordered parts existed: its answer, rendered as it
   *  always was, after its thinking and tool calls. */
  legacyAnswer?: ReactNode;
  /** Lines of live thinking shown under a working group's header. */
  previewLines?: number;
  /** The turn's plan card. While the run is live it follows the newest step;
   *  once it is over it sits where the plan was written, so the turn ends with
   *  its answer. */
  plan?: ReactNode;
}

type Step = AssistantReasoningPart | AssistantToolPart;

export function TurnTimeline({
  message,
  renderText,
  legacyAnswer,
  previewLines = 3,
  plan,
}: TurnTimelineProps): ReactElement {
  const streaming = !!message.isStreaming;
  const tree = useMemo(
    () => groupInvocations(message.toolInvocations ?? [], !!message.isAborted),
    [message.toolInvocations, message.isAborted],
  );
  const ordered = !!message.parts?.length;
  const segments = useMemo(() => {
    const parts: AssistantPart[] = ordered
      ? (message.parts ?? [])
      : legacyParts({ reasoning: message.reasoning, toolCallIds: [...tree.byId.keys()] });
    // A call the user never sees (internal bookkeeping) is not a step.
    return groupTurnParts(parts.filter(part => part.type !== 'tool' || tree.byId.has(part.id)));
  }, [ordered, message.parts, message.reasoning, tree]);

  // The segment the plan card follows (-1: before them all).
  const planAfter = useMemo((): number => {
    const end = segments.length - 1;
    if (streaming) return end;
    const written = segments.findIndex(
      segment =>
        segment.kind === 'steps' &&
        segment.parts.some(part => part.type === 'tool' && isPlanCall(tree.byId.get(part.id))),
    );
    if (written !== -1) return written;
    // No record of where it was written: still ahead of the answer.
    return segments[end]?.kind === 'text' ? end - 1 : end;
  }, [segments, streaming, tree]);
  const planNode = plan ? (
    <div className='my-1 duration-300 animate-in fade-in-0 motion-reduce:animate-none'>{plan}</div>
  ) : null;

  return (
    <div className='flex min-w-0 flex-col gap-1.5'>
      {/* Nothing has streamed yet: a working header so the turn is visibly alive. */}
      {streaming && segments.length === 0 && (
        <StepGroup
          steps={[]}
          tree={tree}
          live
          statusMessage={message.statusMessage}
          previewLines={previewLines}
        />
      )}
      {planAfter < 0 && planNode}
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        return (
          <Fragment key={segment.kind === 'text' ? segment.part.id : segment.id}>
            {segment.kind === 'text' ? (
              <div className='min-w-0'>
                {renderText(segment.part.text, { streaming: streaming && isLast })}
              </div>
            ) : (
              <StepGroup
                steps={segment.parts}
                tree={tree}
                live={streaming && isLast}
                statusMessage={message.statusMessage}
                previewLines={previewLines}
              />
            )}
            {index === planAfter && planNode}
          </Fragment>
        );
      })}
      {!ordered && legacyAnswer}
    </div>
  );
}

/** The plan tool: its call marks where the turn's plan was written. */
function isPlanCall(invocation: ToolInvocation | undefined): boolean {
  const base = invocation?.toolName.split('__').pop() ?? '';
  return /^todo[-_]?write$/i.test(base);
}

/**
 * What a working group is doing right now, for its shimmering header. A
 * running subagent wins — it is the slow part, and parallel calls beside it
 * finish long before it does — then the newest running call, then thinking.
 */
function liveActivity(steps: Step[], tree: InvocationTree): string {
  const running = steps
    .map(step => (step.type === 'tool' ? tree.byId.get(step.id) : undefined))
    .filter((call): call is ToolInvocation => call?.status === 'running');
  const agent = running.find(call =>
    isSubagentCall(call, tree.childrenByParent.get(call.toolCallId ?? '')),
  );
  if (agent) {
    const doing = (tree.childrenByParent.get(agent.toolCallId ?? '') ?? [])
      .filter(child => child.status === 'running')
      .at(-1);
    return doing
      ? `${agentLabel(agent.toolName)} · ${childToolLabel(doing, agent.toolName)}`
      : `${agentLabel(agent.toolName)} is working`;
  }
  const current = steps[steps.length - 1];
  if (current?.type === 'reasoning') return 'Thinking';
  const call = running.at(-1) ?? (current ? tree.byId.get(current.id) : undefined);
  return humanizeToolName(call?.toolName) || 'Working';
}

function StepGroup({
  steps,
  tree,
  live,
  statusMessage,
  previewLines,
}: {
  steps: Step[];
  tree: InvocationTree;
  live: boolean;
  /** The run's latest progress label ("Searching tickets…"). */
  statusMessage?: Message['statusMessage'];
  previewLines: number;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const summary = useMemo(() => summarizeSteps(steps, tree), [steps, tree]);
  const elapsedMs = useElapsedMs(live);

  const current = steps[steps.length - 1];
  const status = Array.isArray(statusMessage)
    ? statusMessage[statusMessage.length - 1]
    : statusMessage;
  // What it is doing right now — held briefly so fast tool calls don't strobe.
  const liveLabel = useStableLabel(
    steps.length === 0
      ? status?.trim().replace(/…$/, '') || 'Thinking'
      : liveActivity(steps, tree),
  );
  const liveThinking = live && current?.type === 'reasoning' ? current.text : '';
  const hasTools = steps.some(step => step.type === 'tool');
  const durationMs = live ? elapsedMs : hasTools ? summary.durationMs : null;
  const canOpen = steps.length > 0;

  return (
    <div className='min-w-0 text-sm'>
      <button
        type='button'
        onClick={() => canOpen && setOpen(value => !value)}
        disabled={!canOpen}
        aria-expanded={open}
        aria-controls={bodyId}
        className='-ml-1 inline-flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-muted-foreground/70 transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:text-muted-foreground/70'
        data-track-category='XyneAI'
        data-track-name='TOGGLE_TURN_STEPS'
      >
        {live ? (
          <span
            key={liveLabel}
            className='typing-shimmer min-w-0 truncate duration-200 animate-in fade-in-0 motion-reduce:animate-none'
          >
            {liveLabel}…
          </span>
        ) : (
          <span className='min-w-0 truncate'>{summary.label}</span>
        )}
        {!live && summary.failed > 0 && (
          <span className='shrink-0'>({summary.failed} failed)</span>
        )}
        {durationMs !== null && durationMs >= 1000 && (
          <span className='shrink-0 text-xs tabular-nums text-muted-foreground/50'>
            {formatSeconds(durationMs)}
          </span>
        )}
        {canOpen && (
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3.5 shrink-0 transition-transform duration-200 motion-reduce:transition-none',
              open && 'rotate-90',
            )}
          />
        )}
      </button>

      {/* The thinking as it streams, a few lines at a time, while collapsed. */}
      <Reveal open={!open && liveThinking.trim().length > 0}>
        <div className='mt-1 pl-1'>
          <LiveReasoning reasoning={liveThinking} lines={previewLines} />
        </div>
      </Reveal>

      <Reveal open={open} id={bodyId}>
        <ul className='mt-1 divide-y divide-border/40 overflow-hidden rounded-lg border border-border/50'>
          {steps.map(step => (
            <li
              key={`${step.type}-${step.id}`}
              className='duration-200 animate-in fade-in-0 slide-in-from-top-1 motion-reduce:animate-none'
            >
              {step.type === 'reasoning' ? (
                <ThinkingStep part={step} />
              ) : (
                <ToolStep id={step.id} tree={tree} />
              )}
            </li>
          ))}
        </ul>
      </Reveal>
    </div>
  );
}

/** A thinking step: its first line reads as the row; opening it un-truncates
 *  that line and reveals the rest, so nothing is shown twice. */
function ThinkingStep({ part }: { part: AssistantReasoningPart }): ReactElement {
  const [open, setOpen] = useState(false);
  const text = part.text.trim();
  const breakAt = text.indexOf('\n');
  const firstLine = breakAt === -1 ? text : text.slice(0, breakAt);
  const rest = breakAt === -1 ? '' : text.slice(breakAt + 1).trim();
  const from = part.startedAt ? Date.parse(part.startedAt) : NaN;
  const to = part.endedAt ? Date.parse(part.endedAt) : NaN;
  const durationMs = Number.isFinite(from) && Number.isFinite(to) ? to - from : null;
  return (
    <div>
      <button
        type='button'
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className='group/row flex w-full items-start gap-2 px-3 py-1 text-left text-[13px] leading-5 text-muted-foreground/70 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none'
        data-track-category='XyneAI'
        data-track-name='TOGGLE_THINKING_STEP'
      >
        <span className='flex min-w-0 items-start gap-1.5'>
          <span className={cn('min-w-0 break-words', !open && 'truncate')}>
            {firstLine || 'Thinking…'}
          </span>
          <ChevronRight
            aria-hidden
            className={cn(
              'mt-[3px] size-3.5 shrink-0 text-muted-foreground/50 transition-transform duration-200 motion-reduce:transition-none',
              open && 'rotate-90',
            )}
          />
        </span>
        {durationMs !== null && durationMs >= 1000 && (
          <span
            className={cn(
              'ml-auto shrink-0 pl-2 text-[11px] tabular-nums text-muted-foreground/50 transition-opacity group-hover/row:opacity-100',
              !open && 'opacity-0',
            )}
          >
            {formatSeconds(durationMs)}
          </span>
        )}
      </button>
      {rest && (
        <Reveal open={open}>
          <p className='max-h-80 overflow-y-auto whitespace-pre-wrap break-words px-3 pb-2 text-xs leading-5 text-muted-foreground/70'>
            {rest}
          </p>
        </Reveal>
      )}
    </div>
  );
}

function ToolStep({ id, tree }: { id: string; tree: InvocationTree }): ReactElement | null {
  const invocation = tree.byId.get(id);
  if (!invocation) return null;
  return <InvocationItem invocation={invocation}>{tree.childrenByParent.get(id)}</InvocationItem>;
}
