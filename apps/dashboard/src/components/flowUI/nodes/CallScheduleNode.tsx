import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { CalendarFilled, ClockDefault, ChevronDown, CheckTickSingle, Spinner } from '@xyne/icons';
import { useFlow } from '../FlowContext';
import AvatarGroup from '../../ui/Avatar/AvatarGroup';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../ui/dropdown-menu';
import { formatTimeAmPm } from '../../../utils/dateUtils';
import type { FlowComponent, CallScheduleProps, CallSlot, DurationMinutes } from '@xyne/shared';
import { cn } from '../../../utils/classNames';
import { Button } from '../../ui/Button/Button';

/**
 * Call-schedule artifact — an interactive scheduling proposal.
 *
 * The agent proposes a call (title + attendees) with several start-time slots
 * and a duration switcher; the human picks a slot + duration and Approves.
 *
 * `props.phase` is the discriminant and picks the layout:
 *   proposed  → duration switcher (30/45/60) + radio slots + Approve/Set-manually.
 *   scheduled → the single confirmed slot (date + range), no switcher, no buttons.
 *
 * ── Start-only slots, derived end ────────────────────────────────────────────
 * Slots carry START ONLY (`{ id, start }`, absolute UTC ISO). The end is DERIVED
 * client-side: end = start + selectedDuration*60_000, so the "4:00 PM – 5:00 PM"
 * range recomputes live when the user switches duration. Times format in the
 * VIEWER's local tz (date-fns). Duration options are fixed here ([30,45,60]),
 * never on the wire; `defaultDuration`/`defaultSlotId` are the agent's initial picks.
 *
 * ── User selection = flow state (freeze-bug discipline) ──────────────────────
 * The chosen { slotId, duration } is user-authored → stored in
 * state.values[node.id] (seeded ONCE on mount from defaults, guarded by
 * `=== undefined`), so it travels with the Approve action's `values`. Everything
 * agent-authoritative (title, attendees, slots, defaults, the scheduled outcome)
 * stays in PROPS, never mirrored into client state.
 *
 * ── Action wiring + v1 IS DISPLAY-ONLY ───────────────────────────────────────
 * Approve is a baked submit actionId (`schedule-approve`) → useFlow()
 * .executeAction; on submit, values['call-schedule'] = { slotId, duration }
 * travels to the backend, which would schedule the call and `updateMessage` the
 * SAME screenId to phase:'scheduled'. BUT v1 has NO backend handler — clicking
 * POSTs and nothing resolves; the card legitimately cannot self-transition (that
 * flip is future work, mirrors plan's proposed→executing). Do NOT fake a local
 * resolved transition. "Set manually" is an INERT placeholder in v1 (no onClick).
 *
 * ── Wire contract ────────────────────────────────────────────────────────────
 * Source of truth + zod: shared/src/validation/flowSchema.ts
 * (`callScheduleComponentSchema`). One component in a FlowJSON FlowDefinition,
 * JSON-stringified + `"`→`&quot;` escaped inside <div data-flow-json="…">.
 *
 *   { version:'2.0', screenId:'agent-call-schedule-<id>', title:'Schedule call',
 *     data?: { ticketId },              // optional backend execute-context
 *     state: { …empty… },
 *     components: [{ id:'call-schedule', type:'call_schedule', props:
 *       // phase 'proposed'
 *       { phase:'proposed', title, attendees:string[], slots:[{id,start}],
 *         defaultSlotId?, defaultDuration?:30|45|60 }
 *       // phase 'scheduled'
 *       { phase:'scheduled', title, attendees:string[], start, duration:30|45|60 }
 *     }] }
 *
 * props is .strict(); slots carry no end; presentation derived below.
 */
interface CallScheduleNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

const APPROVE_ACTION_ID = 'schedule-approve';
const DURATION_OPTIONS: DurationMinutes[] = [30, 45, 60];
const DEFAULT_DURATION: DurationMinutes = 30;

interface Selection {
  slotId: string;
  duration: DurationMinutes;
}

const durationLabel = (d: DurationMinutes): string => (d === 60 ? '1 hr' : `${d} mins`);

export const CallScheduleNode: React.FC<CallScheduleNodeProps> = ({ node }) => {
  const props = node.props as CallScheduleProps | undefined;
  if (!props) return null;

  if (props.phase === 'scheduled') {
    return <ScheduledCall style={node.style} props={props} />;
  }
  return <ProposedCall node={node} props={props} />;
};

const ProposedCall: React.FC<{
  node: FlowComponent;
  props: Extract<CallScheduleProps, { phase: 'proposed' }>;
}> = ({ node, props }) => {
  const { state, updateFieldValue, executeAction } = useFlow();
  const [inFlight, setInFlight] = useState(false);

  // slots is `.min(1)`, so slots[0] always exists; `?.id ?? ''` satisfies the
  // noUncheckedIndexedAccess/exactOptionalPropertyTypes checks without a cast.
  const seedSlotId = props.defaultSlotId ?? props.slots[0]?.id ?? '';
  const seedDuration = props.defaultDuration ?? DEFAULT_DURATION;

  const stored = state.values[node.id] as Selection | undefined;
  const selection: Selection = stored ?? { slotId: seedSlotId, duration: seedDuration };

  // Seed user selection once on mount (agent-authoritative defaults → flow state).
  useEffect(() => {
    if (state.values[node.id] === undefined) {
      updateFieldValue(node.id, { slotId: seedSlotId, duration: seedDuration });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  const setSelection = (next: Selection): void => {
    if (state.submitting) return;
    updateFieldValue(node.id, next);
  };

  const approve = async (): Promise<void> => {
    if (state.submitting) return;
    setInFlight(true);
    try {
      await executeAction({ type: 'submit', actionId: APPROVE_ACTION_ID });
    } finally {
      setInFlight(false);
    }
  };

  return (
    <CardShell style={node.style}>
      <div className='flex flex-col gap-4 p-4'>
        <Header title={props.title} attendees={props.attendees} />

        <div className='h-px w-full bg-border' />

        <div className='flex flex-col gap-3'>
          <div className='flex items-center gap-3'>
            <p className='flex-1 text-sm font-medium leading-[1.2] text-muted-foreground'>
              Available slots
            </p>
            <DurationSwitcher
              value={selection.duration}
              disabled={state.submitting}
              onChange={d => setSelection({ ...selection, duration: d })}
            />
          </div>

          <div className='flex flex-col gap-3'>
            {props.slots.map(slot => (
              <SlotRow
                key={slot.id}
                slot={slot}
                duration={selection.duration}
                selected={slot.id === selection.slotId}
                disabled={state.submitting}
                onSelect={() => setSelection({ ...selection, slotId: slot.id })}
              />
            ))}
          </div>
        </div>
      </div>

      <div className='flex items-center gap-2 border-t border-border bg-foreground/[0.03] px-4 py-3'>
        <Button
          type='button'
          variant='ghost'
          disabled={state.submitting}
          onClick={() => void approve()}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5',
            'text-sm font-medium leading-[1.2] text-foreground',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
          data-track-category='CALL_SCHEDULE_ARTIFACT'
          data-track-name='CLICK_APPROVE'
          trackId='call_schedule_approve'
        >
          {inFlight && <Spinner size={14} className='animate-spin' />}
          Approve
        </Button>
        {/* v1: inert placeholder — no backend manual-scheduler yet. */}
        <button
          type='button'
          className='rounded-lg px-3 py-1.5 text-sm font-medium leading-[1.2] text-foreground/80'
          data-track-category='CALL_SCHEDULE_ARTIFACT'
          data-track-name='CLICK_SET_MANUALLY'
        >
          Set manually
        </button>
      </div>
    </CardShell>
  );
};

const ScheduledCall: React.FC<{
  style?: React.CSSProperties | undefined;
  props: Extract<CallScheduleProps, { phase: 'scheduled' }>;
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
        <SlotLabel start={props.start} duration={props.duration} />
        <ScheduledChip />
      </div>
    </div>
  </CardShell>
);

// Reuses the plan card's approved-chip tokens (green success pill).
const ScheduledChip: React.FC = () => (
  <span className='flex h-[18px] shrink-0 items-center'>
    <span className='rounded px-1 py-px text-xs font-semibold leading-[18px] tracking-[0.2px] bg-[var(--plan-chip-approved-bg)] text-[var(--plan-chip-approved-fg)]'>
      Scheduled
    </span>
  </span>
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

const Header: React.FC<{ title: string; attendees: string[] }> = ({ title, attendees }) => (
  <div className='flex items-start gap-3'>
    <CalendarFilled size={20} className='mt-px shrink-0 text-muted-foreground' />
    <p className='min-w-0 flex-1 text-sm font-semibold leading-[1.3] text-foreground'>{title}</p>
    {attendees.length > 0 && (
      <AvatarGroup userIds={attendees} size='sm' count={3} className='shrink-0' />
    )}
  </div>
);

const DurationSwitcher: React.FC<{
  value: DurationMinutes;
  disabled: boolean;
  onChange: (d: DurationMinutes) => void;
}> = ({ value, disabled, onChange }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild disabled={disabled}>
      <button
        type='button'
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md text-sm font-medium leading-[1.2] text-muted-foreground',
          'hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60',
        )}
        data-track-category='CALL_SCHEDULE_ARTIFACT'
        data-track-name='OPEN_DURATION_SWITCHER'
      >
        <ClockDefault size={16} className='shrink-0' />
        <span className='tabular-nums'>{durationLabel(value)}</span>
        <ChevronDown size={16} className='shrink-0' />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align='end' className='min-w-[7rem]'>
      {DURATION_OPTIONS.map(d => (
        <DropdownMenuItem
          key={d}
          onSelect={() => onChange(d)}
          className={cn(
            'justify-between tabular-nums',
            d === value && 'font-semibold text-foreground',
          )}
        >
          {durationLabel(d)}
          {d === value && <CheckTickSingle size={14} className='shrink-0' />}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);

const SlotRow: React.FC<{
  slot: CallSlot;
  duration: DurationMinutes;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}> = ({ slot, duration, selected, disabled, onSelect }) => (
  <button
    type='button'
    onClick={onSelect}
    disabled={disabled}
    aria-pressed={selected}
    className={cn(
      'flex items-center gap-2 text-left',
      'disabled:cursor-not-allowed disabled:opacity-60',
    )}
    data-track-category='CALL_SCHEDULE_ARTIFACT'
    data-track-name='SELECT_SLOT'
  >
    <RadioSlot>{selected ? <FilledDot /> : <EmptyCircle />}</RadioSlot>
    <SlotLabel start={slot.start} duration={duration} />
  </button>
);

const SlotLabel: React.FC<{ start: string; duration: DurationMinutes }> = ({ start, duration }) => {
  const startDate = new Date(start);
  const endDate = new Date(startDate.getTime() + duration * 60_000);
  const dateLabel = format(startDate, 'EEE d MMM');
  const range = `${formatTimeAmPm(startDate)} - ${formatTimeAmPm(endDate)}`;
  return (
    <span className='flex items-center gap-2 text-sm leading-[1.2]'>
      <span className='font-medium text-foreground tabular-nums'>{dateLabel}</span>
      <span className='text-muted-foreground tabular-nums'>{range}</span>
    </span>
  );
};

const RadioSlot: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className='relative flex size-6 shrink-0 items-center justify-center'>{children}</span>
);

const FilledDot: React.FC = () => (
  <span className='flex size-4 items-center justify-center rounded-full bg-foreground/80'>
    <span className='size-1 rounded-full bg-background' />
  </span>
);

const EmptyCircle: React.FC = () => (
  <span className='size-4 rounded-full border-[1.6px] border-foreground/20' />
);
