import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { ArrowUpRight, CalendarClock } from 'lucide-react';
import type { QueryResultType } from '@rocicorp/zero';
import { CallStatus } from '@xyne/shared';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useCallJoinOrInitiate } from '../../../hooks/useCallJoinOrInitiate';
import { useAllChannels } from '../../../hooks/useChannels';
import { cn } from '../../../utils/classNames';
import type { MessageMetadata } from './MessageBubble.utils';

/**
 * Upper bound on how many of a channel's calls stay subscribed for pill rendering.
 * Pills persist in scroll-back forever, so the subscription is windowed; a card whose
 * call falls outside it renders the muted fallback instead.
 */
const PILL_CALL_WINDOW = 200;

const NOT_A_PARTICIPANT_MESSAGE =
  'You are not a participant of this call. Please request to join the call when it is active.';

type PillCall = QueryResultType<typeof queries.scheduledCallPillCalls>[number];

type PillState = 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED';

/**
 * Everything the card shows is derived from the live `calls` row rather than stored on
 * the message, which is what lets a cancel (via the Zero mutator, which never reaches
 * the backend) or a title/time edit re-render the card with no write to the message.
 */
const toPillState = (status: string | null | undefined): PillState => {
  switch (status) {
    case CallStatus.CANCELLED:
      return 'CANCELLED';
    // IN_PROGRESS is vestigial — nothing ever writes it to calls.status — but every
    // other call surface reads it as a synonym for ACTIVE, so this one does too.
    case CallStatus.ACTIVE:
    case CallStatus.IN_PROGRESS:
      return 'ACTIVE';
    case CallStatus.ENDED:
      return 'ENDED';
    default:
      return 'SCHEDULED';
  }
};

/**
 * Status reads through colour, on the same tokens the ticket and board surfaces use:
 * Upcoming is the blue --status-scheduled, Active green, Cancelled red, and Ended
 * falls back to muted grey. Keys track `calls.status`; labels are the product's
 * vocabulary for them.
 */
const STATE_STYLES: Record<PillState, { chip: string; glyph: string; label: string }> = {
  SCHEDULED: {
    chip: 'bg-status-scheduled/10 text-status-scheduled',
    glyph: 'bg-status-scheduled/10 text-status-scheduled',
    label: 'Upcoming',
  },
  ACTIVE: {
    chip: 'bg-status-success/15 text-status-success',
    glyph: 'bg-status-success/15 text-status-success',
    label: 'Active',
  },
  ENDED: {
    chip: 'bg-muted text-muted-foreground',
    glyph: 'bg-muted text-muted-foreground',
    label: 'Ended',
  },
  CANCELLED: {
    chip: 'bg-status-failure/10 text-status-failure',
    glyph: 'bg-muted text-muted-foreground',
    label: 'Cancelled',
  },
};

/** EntitySharePill's shell, so an in-message call card matches the shared-entity cards. */
const CARD_CLASSES =
  'relative flex w-full max-w-xl flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm';

const GLYPH_CLASSES = 'flex size-5 shrink-0 items-center justify-center rounded-md';

/** Deliberately small: the Join button is the card's primary action, not the status. */
const CHIP_CLASSES =
  'shrink-0 rounded-full px-1.5 py-px text-[9px] font-medium uppercase tracking-wide leading-[14px]';

/**
 * Viewer-local, matching what the same call reads as on the user's own Calls screen
 * (UpcomingCallsList). Deliberately not the backend's formatDateTimeShort, which pins
 * every timestamp to Asia/Kolkata.
 */
const formatWhen = (startsAt: number | null, endsAt: number | null): string | null => {
  if (!startsAt) return null;
  const start = new Date(startsAt);
  const day = format(start, 'EEE d MMM');
  const startTime = format(start, 'h:mm a');
  if (!endsAt) return `${day} · ${startTime}`;
  return `${day} · ${startTime} – ${format(new Date(endsAt), 'h:mm a')}`;
};

interface ScheduledCallPillProps {
  message: {
    messageId: string;
    metadata: MessageMetadata | null;
  };
  /** The call's public externalId, from the message metadata. */
  callId: string;
  channelId: string;
}

export function ScheduledCallPill({
  message,
  callId,
  channelId,
}: ScheduledCallPillProps): React.JSX.Element {
  const navigate = useNavigate();
  const { userID } = useAuthContextValues();
  const { joinCall } = useCallJoinOrInitiate();
  const channels = useAllChannels();
  const [showJoinError, setShowJoinError] = useState(false);

  const metadata = message.metadata as
    | (MessageMetadata & { retired?: boolean; movedTo?: string; movedCallTitle?: string })
    | null;
  const isRetired = metadata?.retired === true;

  const [calls = []] = useCachedQuery(
    queries.scheduledCallPillCalls({ channelId, limit: PILL_CALL_WINDOW }),
  );
  const call = (calls as PillCall[]).find(c => c.externalId === callId);

  // The call moved to another channel. This card is dead: it is never updated again,
  // and moving the call back posts a brand-new pill rather than reviving this one.
  if (isRetired) {
    const movedToName = channels.find(c => c.id === metadata?.movedTo)?.name;
    return (
      <div className={cn(CARD_CLASSES, 'opacity-60')} aria-disabled='true'>
        <div className='flex items-center gap-2.5'>
          <span className={cn(GLYPH_CLASSES, 'bg-muted text-muted-foreground')} aria-hidden='true'>
            <CalendarClock size={14} strokeWidth={2.5} />
          </span>
          <span className='min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground line-through'>
            {metadata?.movedCallTitle ?? 'Scheduled call'}
          </span>
          <span className={cn(CHIP_CLASSES, 'bg-muted text-muted-foreground')}>Moved</span>
        </div>
        <p className='pl-[30px] text-xs text-muted-foreground'>
          {movedToName ? `Moved to #${movedToName}` : 'Moved to another channel'}
        </p>
      </div>
    );
  }

  // Outside the subscription window, or not visible to this viewer.
  if (!call) {
    return (
      <div className={cn(CARD_CLASSES, 'opacity-60')}>
        <div className='flex items-center gap-2.5'>
          <span className={cn(GLYPH_CLASSES, 'bg-muted text-muted-foreground')} aria-hidden='true'>
            <CalendarClock size={14} strokeWidth={2.5} />
          </span>
          <span className='min-w-0 flex-1 truncate text-sm text-muted-foreground'>
            Scheduled call
          </span>
        </div>
      </div>
    );
  }

  const state = toPillState(call.status);
  const styles = STATE_STYLES[state];
  const isJoinable = state === 'SCHEDULED' || state === 'ACTIVE';
  const when = formatWhen(call.startsAt, call.endsAt);

  const handleJoin = (): void => {
    // The organizer always has a participant row (createCallWithParticipants appends
    // them), so this never turns the host away. A channel member who joined after the
    // call was scheduled has no row and is told to ask — the server would still admit
    // them from the Calls screen; this is guidance, not enforcement.
    const isParticipant = (call.participants ?? []).some(p => p.userId === userID);
    if (!isParticipant) {
      setShowJoinError(true);
      toast.error('Not a participant', {
        description: NOT_A_PARTICIPANT_MESSAGE,
        duration: 5000,
      });
      return;
    }

    setShowJoinError(false);
    joinCall({ callId });
  };

  return (
    <div className={cn(CARD_CLASSES, state === 'CANCELLED' && 'opacity-75')}>
      {/* Join sits vertically centred against the whole two-line block rather than on
          the time row, so it lines up with the card's midpoint — the same placement
          CallMessageOverlay gives the live call's Join. */}
      <div className='flex items-center gap-3 pr-5'>
        <span className={cn(GLYPH_CLASSES, styles.glyph)} aria-hidden='true'>
          <CalendarClock size={14} strokeWidth={2.5} />
        </span>

        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
          <div className='flex min-w-0 items-center gap-1.5'>
            <span
              className={cn(
                'min-w-0 truncate text-sm font-medium text-foreground',
                state === 'CANCELLED' && 'text-muted-foreground line-through',
              )}
            >
              {call.title ?? 'Scheduled Call'}
            </span>
            <span className={cn(CHIP_CLASSES, styles.chip)}>{styles.label}</span>
          </div>

          {when && <span className='truncate text-xs text-muted-foreground'>{when}</span>}
        </div>

        <button
          type='button'
          onClick={handleJoin}
          disabled={!isJoinable}
          className={cn(
            'shrink-0 rounded-md border px-4 py-1.5 text-sm font-semibold transition-colors disabled:cursor-default',
            !isJoinable && 'border-border bg-muted text-muted-foreground',
            state === 'ACTIVE' &&
              'border-status-success/30 bg-status-success/10 text-status-success hover:bg-status-success/20',
            state === 'SCHEDULED' &&
              'border-status-scheduled/25 bg-status-scheduled/10 text-status-scheduled hover:bg-status-scheduled/20',
          )}
          data-track-category='CALLS'
          data-track-name='JOIN_CALL_FROM_CHANNEL_PILL'
          data-track-metadata={JSON.stringify({ callId, callStatus: call.status })}
        >
          Join
        </button>
      </div>

      {/* Corner affordance, deliberately quiet — Join is the card's primary action. */}
      <button
        type='button'
        onClick={() => {
          // CallHistoryScreen keys ?callId= on the internal id, not externalId.
          void navigate(`/calls?callId=${call.id}`);
        }}
        aria-label={`Open ${call.title ?? 'call'} in Calls`}
        title='Open in Calls'
        className='absolute right-2 top-2 rounded text-muted-foreground/60 transition-colors hover:text-foreground'
        data-track-category='CALLS'
        data-track-name='OPEN_SCHEDULED_CALL_FROM_PILL'
      >
        <ArrowUpRight size={13} strokeWidth={1.75} aria-hidden='true' />
      </button>

      {showJoinError && (
        <p className='pl-[30px] text-xs text-status-failure'>{NOT_A_PARTICIPANT_MESSAGE}</p>
      )}
    </div>
  );
}

export default ScheduledCallPill;
