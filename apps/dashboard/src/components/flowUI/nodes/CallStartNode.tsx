import React, { useState } from 'react';
import { CalendarFilled, CheckTickSingle, Spinner } from '@xyne/icons';
import { useFlow } from '../FlowContext';
import AvatarGroup from '../../ui/Avatar/AvatarGroup';
import type { FlowComponent, CallStartProps } from '@xyne/shared';
import { cn } from '../../../utils/classNames';

/**
 * Call-start artifact — an ambient "start a call now" proposal.
 *
 * Raised by on-device intent detection when someone writes "can we hop on a
 * call?" in a public channel. The agent suggests a title and the right people;
 * the human starts it or dismisses it.
 *
 * ── Not the same card as `call_schedule` ─────────────────────────────────────
 * `call_schedule` books a FUTURE slot — date, start times, 30/45/60 duration.
 * This one starts a call NOW, so it carries no slots and no duration. Visual
 * language is deliberately shared (Figma 264:3883) so the two read as one family,
 * but they are different products and neither should grow the other's fields.
 *
 * ── This card is UNINVITED ───────────────────────────────────────────────────
 * `call_schedule` shows up because a user asked an agent for it. This one appears
 * next to a message the user merely typed, unprompted. Two consequences:
 *   1. Dismiss is a real, first-class action — not the inert "Set manually"
 *      placeholder. An unsolicited suggestion must be refusable.
 *   2. A dismissal is signal: it is the human telling us the intent classifier
 *      was wrong. That is why it round-trips instead of vanishing client-side.
 *
 * `props.phase` is the discriminant and picks the layout:
 *   proposed  → title + attendees + Start call / Dismiss.
 *   started   → confirmed, with a Join link when the backend supplies one.
 *   dismissed → terminal, muted, read-only.
 *
 * ── Actions + phase transitions are BACKEND-OWNED ────────────────────────────
 * Both buttons are baked submit actionIds (`call-start` / `call-dismiss`) routed
 * through useFlow().executeAction. The backend starts (or records the refusal of)
 * the call and `updateMessage`s the SAME screenId to phase 'started'/'dismissed'.
 *
 * The card must NOT fake a local transition — same discipline as PlanNode and
 * CallScheduleNode. Until the backend handler lands, clicking POSTs and the card
 * legitimately stays in `proposed`; that is the honest state, not a bug to paper
 * over with optimistic UI.
 *
 * ── Wire contract ────────────────────────────────────────────────────────────
 * Source of truth + zod: shared/src/validation/flowSchema.ts
 * (`callStartComponentSchema`). One component in a FlowJSON FlowDefinition,
 * JSON-stringified + `"`→`&quot;` escaped inside <div data-flow-json="…">.
 *
 *   { version:'2.0', screenId:'agent-call-start-<messageId>', title:'Start a call',
 *     state: { …empty… },
 *     components: [
 *       { id:'preamble', type:'text', props:{ content:'Looks like you were trying
 *         to get on a call. Here is a suggestion:' } },
 *       { id:'call-start', type:'call_start', props:
 *         // phase 'proposed' — `rationale` is carried but NOT rendered (see MetaLine)
 *         { phase:'proposed', title, attendees:string[], rationale? }
 *         // phase 'started'
 *         { phase:'started', title, attendees, callId?, joinUrl? }
 *         // phase 'dismissed'
 *         { phase:'dismissed', title, attendees } } ] }
 *
 * `id` must be stable across updates (rows reconcile by it). props is .strict().
 */
interface CallStartNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

const START_ACTION_ID = 'call-start';
const DISMISS_ACTION_ID = 'call-dismiss';

export const CallStartNode: React.FC<CallStartNodeProps> = ({ node }) => {
  const props = node.props as CallStartProps | undefined;
  if (!props) return null;

  if (props.phase === 'started') return <StartedCall style={node.style} props={props} />;
  if (props.phase === 'dismissed') return <DismissedCall style={node.style} props={props} />;
  return <ProposedCall node={node} props={props} />;
};

const ProposedCall: React.FC<{
  node: FlowComponent;
  props: Extract<CallStartProps, { phase: 'proposed' }>;
}> = ({ props }) => {
  const { state, executeAction } = useFlow();
  // Which button is in flight — the other disables so a double-tap can't send
  // both a start and a dismiss for the same suggestion.
  const [pending, setPending] = useState<'start' | 'dismiss' | null>(null);

  const locked = state.submitting || pending !== null;

  const submit = async (actionId: typeof START_ACTION_ID | typeof DISMISS_ACTION_ID) => {
    if (locked) return;
    setPending(actionId === START_ACTION_ID ? 'start' : 'dismiss');
    try {
      await executeAction({ type: 'submit', actionId });
    } finally {
      setPending(null);
    }
  };

  return (
    <CardShell>
      <div className='flex flex-col gap-4 p-4'>
        <Header title={props.title} attendees={props.attendees} />
        <MetaLine attendees={props.attendees} />
      </div>

      <div className='flex items-center gap-2 border-t border-border bg-foreground/[0.03] px-4 py-3'>
        <button
          type='button'
          disabled={locked}
          onClick={() => void submit(START_ACTION_ID)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5',
            'text-sm font-medium leading-[1.2] text-foreground',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
          data-track-category='CALL_START_ARTIFACT'
          data-track-name='CLICK_START_CALL'
        >
          {pending === 'start' && <Spinner size={14} className='animate-spin' />}
          {pending === 'start' ? 'Starting…' : 'Start call'}
        </button>
        <button
          type='button'
          disabled={locked}
          onClick={() => void submit(DISMISS_ACTION_ID)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5',
            'text-sm font-medium leading-[1.2] text-foreground/80',
            'hover:bg-foreground/[0.04] hover:text-foreground',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
          data-track-category='CALL_START_ARTIFACT'
          data-track-name='CLICK_DISMISS'
        >
          {pending === 'dismiss' && <Spinner size={14} className='animate-spin' />}
          Dismiss
        </button>
      </div>
    </CardShell>
  );
};

const StartedCall: React.FC<{
  style?: React.CSSProperties | undefined;
  props: Extract<CallStartProps, { phase: 'started' }>;
}> = ({ style, props }) => (
  <CardShell style={style}>
    <div className='flex flex-col gap-4 p-4'>
      <Header title={props.title} attendees={props.attendees} />

      <div className='h-px w-full bg-border' />

      <div className='flex items-center gap-2'>
        <span className='flex size-4 shrink-0 items-center justify-center rounded-full bg-foreground/80'>
          <CheckTickSingle
            size={12}
            strokeWidth={1.33}
            absoluteStrokeWidth
            className='text-background'
          />
        </span>
        <span className='flex-1 text-sm leading-[1.2] text-muted-foreground'>Call started</span>
        {props.joinUrl && (
          <a
            href={props.joinUrl}
            target='_blank'
            rel='noreferrer'
            className='rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium leading-[1.2] text-foreground'
            data-track-category='CALL_START_ARTIFACT'
            data-track-name='CLICK_JOIN'
          >
            Join
          </a>
        )}
      </div>
    </div>
  </CardShell>
);

const DismissedCall: React.FC<{
  style?: React.CSSProperties | undefined;
  props: Extract<CallStartProps, { phase: 'dismissed' }>;
}> = ({ style, props }) => (
  <CardShell style={style}>
    <div className='flex flex-col gap-4 p-4 opacity-60'>
      <Header title={props.title} attendees={props.attendees} />
    </div>
    <div className='border-t border-border bg-foreground/[0.03] px-4 py-3'>
      <span className='text-xs leading-[1.2] text-muted-foreground'>Dismissed</span>
    </div>
  </CardShell>
);

const CardShell: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties | undefined;
}> = ({ children, style }) => (
  <div
    className='flex w-full max-w-[450px] flex-col overflow-hidden rounded-xl border border-border bg-card'
    style={style}
  >
    {children}
  </div>
);

// Mirrors CallScheduleNode's header — same icon included — so the two cards read as
// one family (Figma 264:3883).
const Header: React.FC<{ title: string; attendees: string[] }> = ({ title, attendees }) => (
  <div className='flex items-start gap-3'>
    <CalendarFilled size={20} className='mt-px shrink-0 text-muted-foreground' />
    <p className='min-w-0 flex-1 text-sm font-semibold leading-[1.3] text-foreground'>{title}</p>
    {attendees.length > 0 && (
      <AvatarGroup userIds={attendees} size='sm' count={3} className='shrink-0' />
    )}
  </div>
);

// Occupies the slot where call_schedule shows "Thu 16 Jul · 4:00 PM – 5:00 PM".
// There is no time to show for a call starting now, so this carries the headcount.
//
// `props.rationale` is deliberately NOT rendered. It still travels the pipeline —
// the agent produces it, the schema carries it, and it is worth having when judging
// why a suggestion picked the people it did — but as card copy it reads as the agent
// explaining itself to the user, which is not what the user needs at the moment of
// deciding whether to start a call.
const MetaLine: React.FC<{ attendees: string[] }> = ({ attendees }) => (
  <div className='flex items-center gap-2 text-sm leading-[1.2] text-muted-foreground'>
    <span className='shrink-0'>Now</span>
    <span aria-hidden className='shrink-0'>
      ·
    </span>
    <span className='shrink-0 tabular-nums'>
      {attendees.length} {attendees.length === 1 ? 'person' : 'people'}
    </span>
  </div>
);
