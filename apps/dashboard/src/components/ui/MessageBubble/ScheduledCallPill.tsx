import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Phone, XCircle } from 'lucide-react';
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
        <div className='xs-cc xs-cc--flat' aria-disabled='true'>
          <span className='xs-cc__glyph xs-cc__glyph--faint'>
            <XCircle size={ICON_SIZE} strokeWidth={1.8} aria-hidden='true' />
          </span>
          <div className='xs-cc__body'>
            <span className='xs-cc__title xs-cc__title--muted'>
              {metadata.movedCallTitle ?? 'Scheduled call'}
            </span>
            <span className='xs-cc__meta xs-cc__meta--faint'>
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
        <div className='xs-cc xs-cc--flat'>
          <span className='xs-cc__glyph xs-cc__glyph--faint'>
            <Calendar size={ICON_SIZE} strokeWidth={1.6} aria-hidden='true' />
          </span>
          <span className='xs-cc__title xs-cc__title--muted'>Scheduled call</span>
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
            {state === 'ENDED' ? (
              <Phone size={ICON_SIZE} strokeWidth={1.9} aria-hidden='true' />
            ) : null}
            {state === 'CANCELLED' ? (
              <XCircle size={ICON_SIZE} strokeWidth={1.8} aria-hidden='true' />
            ) : null}
            {state === 'SCHEDULED' ? (
              <Calendar size={ICON_SIZE} strokeWidth={1.6} aria-hidden='true' />
            ) : null}
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
            <span className={cn(isActive && 'xs-cc__status--call')}>
              {PILL_STATUS_LABEL[state]} ·
            </span>
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
    </div>
  );
}

export default ScheduledCallPill;
