import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, XCircle } from 'lucide-react';
import { PhoneDefault } from '@xyne/icons';
import { useCallJoinOrInitiate } from '../../../hooks/useCallJoinOrInitiate';
import { useAllChannels } from '../../../hooks/useChannels';
import { cn } from '../../../utils/classNames';
import { PILL_STATUS_LABEL, formatCallWindow, toPillState } from '../../../utils/scheduledCallPill';
import type { MessageMetadata, ScheduledCallPillSnapshot } from './MessageBubble.utils';
import './ScheduledCallPill.css';

const ICON_SIZE = 19;

interface ScheduledCallPillProps {
  message: {
    messageId: string;
    metadata: MessageMetadata | null;
  };
  /** The call's public externalId, from the message metadata. */
  callId: string;
}

// Shared card base classes (layout, border, shape, transition).
const CARD_BASE =
  'relative flex items-center gap-3 w-full max-w-[560px] px-[13px] py-[10px] border rounded-[11px] transition-[border-color,box-shadow] duration-150';

export function ScheduledCallPill({ message, callId }: ScheduledCallPillProps): React.JSX.Element {
  const navigate = useNavigate();
  const { joinCall } = useCallJoinOrInitiate();
  const channels = useAllChannels();

  const metadata = message.metadata;
  const call: ScheduledCallPillSnapshot | undefined = metadata?.call;

  // The call moved channels. This card is dead and is never updated again.
  if (metadata?.retired === true) {
    const movedToName = channels.find(c => c.id === metadata.movedTo)?.name;
    return (
      <div className='xs-cc-scope'>
        <div
          className={cn(
            CARD_BASE,
            'bg-[var(--cc-bg2)] border-[var(--cc-bd)] shadow-none',
            'hover:border-[var(--cc-t6)] hover:shadow-none',
          )}
          aria-disabled='true'
        >
          <span className='flex-shrink-0 inline-flex self-start mt-[1px] text-[var(--cc-t6)]'>
            <XCircle size={ICON_SIZE} strokeWidth={1.8} aria-hidden='true' />
          </span>
          <div className='flex-1 min-w-0 flex flex-col gap-[2px]'>
            <span className='text-[13.5px] font-semibold tracking-[-0.2px] text-[var(--cc-t4)] whitespace-nowrap overflow-hidden text-ellipsis'>
              {metadata.movedCallTitle ?? 'Scheduled call'}
            </span>
            <span className='flex gap-[5px] font-mono text-[11.5px] text-[var(--cc-t5)] whitespace-nowrap'>
              {movedToName ? `Moved to #${movedToName}` : 'Moved to another channel'}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Pills written before the snapshot was added to the metadata.
  if (!call) {
    return (
      <div className='xs-cc-scope'>
        <div
          className={cn(
            CARD_BASE,
            'bg-[var(--cc-bg2)] border-[var(--cc-bd)] shadow-none',
            'hover:border-[var(--cc-t6)] hover:shadow-none',
          )}
        >
          <span className='flex-shrink-0 inline-flex self-start mt-[1px] text-[var(--cc-t6)]'>
            <Calendar size={ICON_SIZE} strokeWidth={1.6} aria-hidden='true' />
          </span>
          <span className='flex-1 min-w-0 text-[13.5px] font-semibold tracking-[-0.2px] text-[var(--cc-t4)] whitespace-nowrap overflow-hidden text-ellipsis'>
            Scheduled call
          </span>
        </div>
      </div>
    );
  }

  const state = toPillState(call.status);
  const isActive = state === 'ACTIVE';
  const isSettled = state === 'ENDED' || state === 'CANCELLED';
  const isReschedule = state === 'CANCELLED';
  const isOpenSummary = state === 'ENDED';
  const when = formatCallWindow(call.startsAt, call.endsAt);
  const channelName = channels.find(c => c.id === call.channelId)?.name;

  // CallHistoryScreen keys ?callId= on the internal id, not externalId.
  const openInCalls = (): void => {
    void navigate(`/calls?callId=${call.id}`);
  };

  const openSummary = (): void => {
    void navigate(`/calls/${call.id}/detail`);
  };

  const handleJoin = (): void => {
    joinCall({ callId });
  };

  return (
    <div className='xs-cc-scope flex w-full max-w-[560px] flex-col gap-2'>
      <p className='text-[13.5px] leading-[1.55] text-muted-foreground'>
        scheduled a call{channelName ? ` in #${channelName}` : ''}
      </p>

      <div
        className={cn(
          CARD_BASE,
          isActive
            ? 'bg-[var(--cc-call-bg)] border-[var(--cc-call-bd)] shadow-[0_1px_3px_rgba(20,22,26,0.07)] hover:border-[var(--cc-call-bd)] hover:shadow-[0_1px_3px_rgba(20,22,26,0.07)]'
            : isSettled
              ? 'bg-[var(--cc-bg2)] border-[var(--cc-bd)] shadow-none hover:border-[var(--cc-t6)] hover:shadow-none'
              : 'bg-[var(--cc-bg)] border-[var(--cc-bd)] shadow-[0_1px_3px_rgba(20,22,26,0.07)] hover:border-[var(--cc-t6)] hover:shadow-[0_5px_18px_rgba(0,0,0,0.06)]',
        )}
      >
        {isActive ? (
          <span
            className='flex-shrink-0 self-start mt-[7px] w-[7px] h-[7px] rounded-full bg-[var(--cc-call)]'
            aria-hidden='true'
          />
        ) : (
          <span
            className={cn(
              'flex-shrink-0 inline-flex self-start mt-[1px]',
              state === 'ENDED' && 'text-[var(--cc-t5)]',
              state === 'CANCELLED' && 'text-[var(--cc-t6)]',
              state === 'SCHEDULED' && 'text-[var(--cc-t4)]',
            )}
          >
            {state === 'ENDED' ? <PhoneDefault size={ICON_SIZE} aria-hidden='true' /> : null}
            {state === 'CANCELLED' ? (
              <XCircle size={ICON_SIZE} strokeWidth={1.8} aria-hidden='true' />
            ) : null}
            {state === 'SCHEDULED' ? (
              <Calendar size={ICON_SIZE} strokeWidth={1.6} aria-hidden='true' />
            ) : null}
          </span>
        )}

        <div className='flex-1 min-w-0 flex flex-col gap-[2px]'>
          <span
            className={cn(
              'text-[13.5px] font-semibold tracking-[-0.2px] whitespace-nowrap overflow-hidden text-ellipsis',
              state === 'ENDED'
                ? 'text-[var(--cc-t2)]'
                : state === 'CANCELLED'
                  ? 'text-[var(--cc-t4)]'
                  : 'text-[var(--cc-t1)]',
            )}
          >
            {call.title ?? 'Scheduled Call'}
          </span>

          <span
            className={cn(
              'flex gap-[5px] font-mono text-[11.5px] whitespace-nowrap',
              state === 'CANCELLED' ? 'text-[var(--cc-t5)]' : 'text-[var(--cc-t4)]',
            )}
          >
            <span className={cn(isActive && 'text-[var(--cc-call-text)]')}>
              {PILL_STATUS_LABEL[state]} ·
            </span>
            {when && <span className={cn(state === 'CANCELLED' && 'line-through')}>{when}</span>}
          </span>
        </div>

        <button
          type='button'
          onClick={isReschedule ? openInCalls : isOpenSummary ? openSummary : handleJoin}
          className={cn(
            'flex-shrink-0 inline-flex items-center justify-center gap-2 h-[30px] px-[13px]',
            'border rounded-md text-[13px] font-semibold tracking-[-0.1px] cursor-pointer whitespace-nowrap',
            'transition-[background,border-color,opacity] duration-[120ms]',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cc-call)]',
            isActive
              ? 'bg-[var(--cc-call)] text-white border-transparent hover:bg-[var(--cc-call-hover)]'
              : 'bg-[var(--cc-bg)] text-[var(--cc-t1)] border-[var(--cc-bd)] hover:border-[var(--cc-t1)] hover:bg-[var(--cc-bg2)]',
          )}
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
    </div>
  );
}

export default ScheduledCallPill;
