/** Inline "Suggested by Xyne" card under a message the on-device classifier read as a call intent. */
import React, { useEffect, useState } from 'react';
import { ChannelScopeType, ChannelVisibility, UserType } from '@xyne/shared';
import {
  CalendarFilled,
  Hashtag,
  Lock02Close,
  MultipleCrossCancelDefault,
  PhoneDefault,
  UserTwo,
} from '@xyne/icons';
import { XyneAIStar } from '@/components/icons/xyne-ai';
import Avatar from '../../ui/Avatar/Avatar';
import { AvatarStackItem } from '../../ui/Avatar/AvatarGroup';
import { Button } from '../../ui/Button/Button';
import { cn } from '../../../utils/classNames';
import { ScheduleCallModal } from '../../Call/ScheduleCallModal/ScheduleCallModal';
import { InstantCallModal } from '../../Call/InstantCallModal/InstantCallModal';
import { CallConfirmationModal } from '../../Call/CallConfirmationModal';
import { useAuth } from '../../../hooks/useAuth';
import { useUsers } from '../../../hooks/useUsers';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useChannel } from '../../../hooks/useChannels';
import { queries } from '../../../zero/queries';
import { useCallActions } from '../../../hooks/useCallActions';
import { useCallConfirmation } from '../../../hooks/useCallConfirmation';
import { useCallJoinOrInitiate } from '../../../hooks/useCallJoinOrInitiate';
import { globalClickTracker } from '../../../services/Analytics/globalClickTracker';
import { getUserDisplayName, isUserDeactivated } from '../../../utils/userDisplayName';
import {
  removeIntentCallSuggestion,
  type IntentCallSuggestion,
} from '../../../stores/intentCallSuggestionStore';

interface IntentCallSuggestionCardProps {
  messageId: string;
  channelId: string;
  conversationId?: string | undefined;
  suggestion: IntentCallSuggestion;
}

const NAMES_SHOWN = 3;
const TRACK_CATEGORY = 'INTENT_SUGGESTION';

// A remount (scrolling back to the message) is not a second impression.
const impressed = new Set<string>();

export const IntentCallSuggestionCard: React.FC<IntentCallSuggestionCardProps> = ({
  messageId,
  channelId,
  conversationId,
  suggestion,
}) => {
  const { participantIds: sentWith, surface, intentKey } = suggestion;
  const [open, setOpen] = useState(true);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [instantOpen, setInstantOpen] = useState(false);
  const { user } = useAuth();
  const users = useUsers();
  const { initiateCall } = useCallJoinOrInitiate();
  const [conversation] = useCachedQuery(
    queries.getConversationById({ conversationId: conversationId ?? '' }),
    { enabled: !!conversationId },
  );

  const channel = useChannel(channelId);
  const trackable = channel?.visibility === ChannelVisibility.PUBLIC;
  const [shownAt] = useState(() => Date.now());
  useEffect(() => {
    if (!trackable || impressed.has(messageId)) return;
    impressed.add(messageId);
    globalClickTracker.trackManualEvent(TRACK_CATEGORY, 'SUGGESTION_SHOWN', undefined, {
      intentKey,
      surface,
      hasAction: true,
    });
  }, [trackable, messageId, intentKey, surface]);
  const trackAction = (action: string): void => {
    if (!trackable) return;
    globalClickTracker.trackManualEvent(TRACK_CATEGORY, 'ACT_ON_INTENT_SUGGESTION', action, {
      intentKey,
      action,
      surface,
      msShown: Date.now() - shownAt,
    });
  };
  const dismiss = (): void => {
    if (trackable) {
      globalClickTracker.trackManualEvent(TRACK_CATEGORY, 'SUGGESTION_DISMISSED', undefined, {
        intentKey,
        reason: 'closed',
        surface,
        msShown: Date.now() - shownAt,
      });
    }
    removeIntentCallSuggestion(messageId);
  };

  // A channel message calls the whole channel; a thread or group DM calls its people.
  // `sentWith` covers the sender's own @mentions before the server row lands.
  const isThread = !!conversationId;
  const isGroupDm = channel?.scopeType === ChannelScopeType.GROUP_DM;
  const ChannelGlyph = isGroupDm
    ? UserTwo
    : channel?.visibility === ChannelVisibility.PRIVATE
      ? Lock02Close
      : Hashtag;
  const showPeople = isThread || isGroupDm;
  const [channelParticipants] = useCachedQuery(queries.channelParticipants({ channelId }), {
    enabled: isGroupDm && !isThread,
  });
  const candidateIds = isThread
    ? [
        ...sentWith,
        ...(conversation?.participants ?? [])
          .filter(p => p.participationType !== null && p.participationType !== undefined)
          .map(p => p.userId),
      ]
    : isGroupDm
      ? (channelParticipants ?? []).map(p => p.userId)
      : [];
  const people = [...new Set(candidateIds)]
    .filter(id => id !== user?.id)
    .map(id => users.find(u => u.id === id))
    // Participant rows can carry ids with no profile; those render as a nameless avatar.
    .filter(
      (u): u is NonNullable<typeof u> =>
        u !== undefined && u.userType === UserType.USER && !isUserDeactivated(u),
    );
  const participantIds = people.map(u => u.id);
  const prefill = showPeople ? participantIds : [`channel:${channelId}`];

  const { handleCallClick, hasActiveCallInChannel, isUserInCurrentChannelCall, isInCall } =
    useCallActions({ channelId });
  const threadCallActive = isThread && !!conversation?.callId;
  const alreadyInThisCall = !isThread && isUserInCurrentChannelCall;
  const joinsExisting = !isThread && hasActiveCallInChannel && !isUserInCurrentChannelCall;
  const startLabel = threadCallActive
    ? 'Call in progress'
    : alreadyInThisCall
      ? 'In this call'
      : joinsExisting
        ? 'Join call'
        : 'Start call';

  // Only the switch-calls prompt: the card already confirms starting a call.
  const { showConfirmModal, modalContent, handleCallAction, handleConfirmCall, closeModal } =
    useCallConfirmation({
      scopeType: channel?.scopeType,
      channelName: channel?.name,
      hasActiveCallInChannel: !isThread && hasActiveCallInChannel,
      isUserInCurrentChannelCall: !isThread && isUserInCurrentChannelCall,
      isInCall,
      onlyShowSwitchModal: true,
    });
  const proceedStart = (): void => {
    if (joinsExisting) {
      handleCallClick();
      removeIntentCallSuggestion(messageId);
      return;
    }
    setInstantOpen(true);
  };
  const onStart = (): void => {
    trackAction(startLabel);
    handleCallAction(proceedStart);
  };

  // initiateCall leaves any current call first, then starts.
  const startCall = (selected: string[]): void => {
    // The picker lets the user swap the prefilled channel for another.
    const pickedChannel = selected.find(p => p.startsWith('channel:'))?.slice(8);
    if (pickedChannel) {
      initiateCall({
        channelId: pickedChannel,
        onComplete: () => removeIntentCallSuggestion(messageId),
      });
      return;
    }
    const targetUserIds = selected.filter(p => p.startsWith('user:')).map(p => p.slice(5));
    if (user?.id) targetUserIds.push(user.id);
    initiateCall({
      channelId,
      ...(conversationId && { conversationId }),
      targetUserIds,
      onComplete: () => removeIntentCallSuggestion(messageId),
    });
  };

  const names = people.map(u => getUserDisplayName(u).split(' ')[0]);
  const extra = names.length - NAMES_SHOWN;
  const namesLine = !showPeople ? (
    channel?.name ? (
      <>
        Everyone in <ChannelGlyph size={14} className='shrink-0' />
        <span className='truncate'>{channel.name}</span>
      </>
    ) : null
  ) : names.length > 0 ? (
    <span className='flex min-w-0 items-center gap-1'>
      {isGroupDm && <ChannelGlyph size={14} className='shrink-0' />}
      {names.slice(0, NAMES_SHOWN).join(', ')}
      {extra > 0 ? ` +${extra}` : ''} from this {isThread ? 'thread' : 'group'}
    </span>
  ) : null;

  return (
    <>
      <div className='flex flex-col items-start pt-2'>
        <Button
          variant='outline'
          size='inline'
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className={cn(
            'rounded-lg px-3 py-1 text-sm font-normal text-muted-foreground',
            open && 'bg-accent',
          )}
        >
          <XyneAIStar size={14} />1 Suggestion
        </Button>
        {open && (
          <div className='w-full max-w-md pt-2'>
            <div className='w-full rounded-2xl border bg-card p-4 text-card-foreground shadow-xs'>
              <div className='flex items-start justify-between text-sm text-muted-foreground'>
                <span className='flex items-center gap-1.5 text-sm'>
                  <XyneAIStar size={14} />
                  Suggested by Xyne
                </span>
                <Button
                  variant='ghost'
                  size='iconSm'
                  onClick={dismiss}
                  aria-label='Dismiss suggestion'
                  className='size-6 rounded-lg'
                >
                  <MultipleCrossCancelDefault className='size-4' strokeWidth={2} />
                </Button>
              </div>
              <div className='mt-2 text-sm font-medium'>
                Start a {isThread ? 'Thread' : isGroupDm ? 'Group' : 'Channel'} Call
              </div>
              {namesLine && (
                <div className='mt-1.5 flex items-center gap-2 text-sm text-muted-foreground'>
                  {participantIds.length > 0 && (
                    <div className='flex items-center -space-x-1.5'>
                      {participantIds.slice(0, NAMES_SHOWN).map(userId => (
                        <AvatarStackItem
                          key={userId}
                          size={24}
                          className='z-10 rounded-md ring-[1px] ring-card'
                          data-slot='avatar-stack-item'
                        >
                          <Avatar userId={userId} size='rg' showActiveStatus={false} />
                        </AvatarStackItem>
                      ))}
                    </div>
                  )}
                  <span className='flex min-w-0 items-center gap-1'>{namesLine}</span>
                </div>
              )}
              <div className='mt-3 flex justify-end gap-2 items-center'>
                <Button
                  variant='outline'
                  onClick={() => {
                    trackAction('Schedule');
                    setScheduleOpen(true);
                  }}
                  className='rounded-lg h-8'
                >
                  <CalendarFilled size={16} />
                  Schedule
                </Button>
                <Button
                  onClick={onStart}
                  disabled={threadCallActive || alreadyInThisCall}
                  className='rounded-lg h-8'
                >
                  <PhoneDefault size={16} />
                  {startLabel}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
      <ScheduleCallModal
        isOpen={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onSuccess={() => removeIntentCallSuggestion(messageId)}
        {...(isThread && { channelId, conversationId })}
        initialParticipants={prefill}
      />
      <InstantCallModal
        isOpen={instantOpen}
        onClose={() => setInstantOpen(false)}
        onSubmit={startCall}
        initialParticipants={prefill}
      />
      <CallConfirmationModal
        isOpen={showConfirmModal}
        onClose={closeModal}
        onConfirm={() => handleConfirmCall(proceedStart)}
        title={modalContent.title}
        subtitle={modalContent.subtitle}
        description={modalContent.description}
      />
    </>
  );
};
