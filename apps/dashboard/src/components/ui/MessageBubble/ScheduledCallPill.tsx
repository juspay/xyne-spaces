import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { toast } from 'sonner';
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

const STATUS_LABEL: Record<PillState, string> = {
  SCHEDULED: 'Upcoming',
  ACTIVE: 'Active',
  ENDED: 'Ended',
  CANCELLED: 'Cancelled',
};

/**
 * Glyph geometry is verbatim from the design system (Calendar 1.6@20, Phone 1.9@24,
 * XCircle 1.8@20) — never redrawn.
 */
const CalendarGlyph = (): React.JSX.Element => (
  <svg
    width={19}
    height={19}
    viewBox='0 0 20 20'
    fill='none'
    stroke='currentColor'
    strokeWidth={1.6}
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-hidden='true'
  >
    <rect x='3.5' y='4.5' width='13' height='12' rx='2' />
    <path d='M3.5 8h13' />
    <path d='M7 3.5v3M13 3.5v3' />
  </svg>
);

const PhoneGlyph = (): React.JSX.Element => (
  <svg
    width={19}
    height={19}
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth={1.9}
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-hidden='true'
  >
    <path d='M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z' />
  </svg>
);

const CancelGlyph = (): React.JSX.Element => (
  <svg
    width={19}
    height={19}
    viewBox='0 0 20 20'
    fill='none'
    stroke='currentColor'
    strokeWidth={1.8}
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-hidden='true'
  >
    <circle cx='10' cy='10' r='7' />
    <path d='M7.6 7.6 12.4 12.4M12.4 7.6 7.6 12.4' />
  </svg>
);

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
      <div className='xs-cc-scope'>
        <div className='xs-cc xs-cc--flat' aria-disabled='true'>
          <span className='xs-cc__glyph xs-cc__glyph--faint'>
            <CancelGlyph />
          </span>
          <div className='xs-cc__body'>
            <span className='xs-cc__title xs-cc__title--muted'>
              {metadata?.movedCallTitle ?? 'Scheduled call'}
            </span>
            <span className='xs-cc__meta xs-cc__meta--faint'>
              {movedToName ? `Moved to #${movedToName}` : 'Moved to another channel'}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Outside the subscription window, or not visible to this viewer.
  if (!call) {
    return (
      <div className='xs-cc-scope'>
        <div className='xs-cc xs-cc--flat'>
          <span className='xs-cc__glyph xs-cc__glyph--faint'>
            <CalendarGlyph />
          </span>
          <span className='xs-cc__title xs-cc__title--muted'>Scheduled call</span>
        </div>
      </div>
    );
  }

  const state = toPillState(call.status);
  const isActive = state === 'ACTIVE';
  const isSettled = state === 'ENDED' || state === 'CANCELLED';
  // A cancelled call has nothing to join, so its action becomes Reschedule and hands
  // the viewer to the Calls screen to rebook — the design system's own `cancelled`
  // action.
  const isReschedule = state === 'CANCELLED';
  // Ended calls open their summary page instead, per the design system's own `ended`
  // action. Always available: the viewer can read this call row — that is what renders
  // the card — so the detail screen's own ACL will let them in.
  const isOpenSummary = state === 'ENDED';
  const when = formatWhen(call.startsAt, call.endsAt);
  const channelName = channels.find(c => c.id === call.channelId)?.name;

  // CallHistoryScreen keys ?callId= on the internal id, not externalId.
  const openInCalls = (): void => {
    void navigate(`/calls?callId=${call.id}`);
  };

  // The call's summary page (CallDetailScreen), keyed on the internal id like every
  // other summary entry point (RecordingSummaryActivity, CallShareBubble).
  const openSummary = (): void => {
    void navigate(`/calls/${call.id}/detail`);
  };

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
    <div className='xs-cc-scope flex w-full max-w-[560px] flex-col gap-2'>
      {/* Sits where a ticket-creation message's line sits — above its card. The
          author is already named in the message header, so it is not repeated. */}
      <p className='text-[13.5px] leading-[1.55] text-muted-foreground'>
        scheduled a call{channelName ? ` in #${channelName}` : ''}
      </p>

      <div className={cn('xs-cc', isActive && 'xs-cc--active', isSettled && 'xs-cc--flat')}>
        {isActive ? (
          <span className='xs-cc__dot' aria-hidden='true' />
        ) : (
          <span
            className={cn(
              'xs-cc__glyph',
              state === 'ENDED' && 'xs-cc__glyph--ended',
              state === 'CANCELLED' && 'xs-cc__glyph--faint',
            )}
          >
            {state === 'ENDED' ? <PhoneGlyph /> : null}
            {state === 'CANCELLED' ? <CancelGlyph /> : null}
            {state === 'SCHEDULED' ? <CalendarGlyph /> : null}
          </span>
        )}

        <div className='xs-cc__body'>
          <span
            className={cn(
              'xs-cc__title',
              state === 'ENDED' && 'xs-cc__title--dim',
              state === 'CANCELLED' && 'xs-cc__title--muted',
            )}
          >
            {call.title ?? 'Scheduled Call'}
          </span>

          <span className={cn('xs-cc__meta', state === 'CANCELLED' && 'xs-cc__meta--faint')}>
            <span className={cn(isActive && 'xs-cc__status--call')}>{STATUS_LABEL[state]} ·</span>
            {when && (
              <span className={cn(state === 'CANCELLED' && 'xs-cc__meta--struck')}>{when}</span>
            )}
          </span>
        </div>

        <button
          type='button'
          onClick={isReschedule ? openInCalls : isOpenSummary ? openSummary : handleJoin}
          className={cn('xs-cc__btn', isActive ? 'xs-cc__btn--call' : 'xs-cc__btn--secondary')}
          data-track-category='CALLS'
          data-track-name={
            isReschedule
              ? 'RESCHEDULE_CALL_FROM_CHANNEL_PILL'
              : isOpenSummary
                ? 'OPEN_CALL_SUMMARY_FROM_CHANNEL_PILL'
                : 'JOIN_CALL_FROM_CHANNEL_PILL'
          }
          data-track-metadata={JSON.stringify({ callId, callStatus: call.status })}
        >
          {isReschedule ? 'Reschedule' : isOpenSummary ? 'Open summary' : 'Join'}
        </button>
      </div>

      {showJoinError && <p className='text-xs text-status-failure'>{NOT_A_PARTICIPANT_MESSAGE}</p>}
    </div>
  );
}

export default ScheduledCallPill;
