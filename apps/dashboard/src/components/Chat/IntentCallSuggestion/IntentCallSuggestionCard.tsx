import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from '@xstate/react';
import { toast } from 'sonner';
import { CalendarDefault, PhoneDefault, SparkleAi01 } from '@xyne/icons';
import { X } from 'lucide-react';
import { Button } from '../../ui/Button';
import AvatarGroup from '../../ui/Avatar/AvatarGroup';
import Tooltip from '../../ui/Tooltip';
import { CallConfirmationModal } from '../../Call/CallConfirmationModal';
import { CallParticipantsSelectionModal } from '../../Call/CallParticipantsSelectionModal';
import { ScheduleCallModal } from '../../Call/ScheduleCallModal/ScheduleCallModal';
import { useAuth } from '../../../hooks/useAuth';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useCallActions } from '../../../hooks/useCallActions';
import { useCallConfirmation } from '../../../hooks/useCallConfirmation';
import { useChannel } from '../../../hooks/useChannels';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import { roomActor } from '../../../machines/roomMachine';
import { isSdlcSurface } from '../../../config';
import { useUsersById } from '../../../hooks/useUsers';
import { queries } from '../../../zero/queries';
import { globalClickTracker } from '../../../services/Analytics/globalClickTracker';
import {
  dismissIntentCallSuggestion,
  type IntentCallSuggestion,
} from '../../../stores/intentCallSuggestionStore';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { cn } from '../../../utils/classNames';

interface IntentCallSuggestionCardProps {
  suggestion: IntentCallSuggestion;
  channelId: string;
  conversationId: string;
}

const NAMED_PARTICIPANTS = 2;
const VISIBLE_AVATARS = 3;

const TRACK_CATEGORY = 'INTENT_SUGGESTION';

const START_TIMEOUT_MS = 20_000;

export const IntentCallSuggestionCard: React.FC<IntentCallSuggestionCardProps> = ({
  suggestion,
  channelId,
  conversationId,
}) => {
  const { detection, shownAt } = suggestion;
  const isThread = detection.surface === 'thread';
  const { user: currentUser } = useAuth();
  const currentUserId = currentUser?.id ?? '';
  const channel = useChannel(channelId);
  const { displayName: channelDisplayName } = useChannelDisplayName(channel, currentUserId);
  const usersById = useUsersById();

  const [expanded, setExpanded] = useState(true);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const intentKey = detection.intentId;
  const toggleExpanded = useCallback((): void => setExpanded(v => !v), []);

  const [conversation] = useCachedQuery(queries.getConversationById({ conversationId }), {
    enabled: isThread,
  });
  const threadUserIds = useMemo((): string[] => {
    if (!isThread) return [];
    return (conversation?.participants ?? [])
      .filter(p => p.participationType !== null && p.participationType !== undefined)
      .map(p => p.userId)
      .filter(id => id !== currentUserId);
  }, [isThread, conversation?.participants, currentUserId]);

  const shownParticipants = useMemo(
    (): Array<{ id: string; name: string }> =>
      threadUserIds.flatMap(id => {
        const u = usersById.get(id);
        const name = u ? getUserDisplayName(u) : '';
        return name ? [{ id, name }] : [];
      }),
    [threadUserIds, usersById],
  );
  const shownParticipantIds = useMemo(
    (): string[] => shownParticipants.map(p => p.id),
    [shownParticipants],
  );

  const participantsLabel = useMemo((): string => {
    const names = shownParticipants.map(p => p.name);
    if (names.length === 0) return 'Just you so far';
    if (names.length === 1) return names[0] ?? '';
    const [first, second] = names;
    const rest = names.length - NAMED_PARTICIPANTS;
    if (rest <= 0) return `${first} and ${second}`;
    return `${first}, ${second} and ${rest} more ${rest === 1 ? 'person' : 'people'}`;
  }, [shownParticipants]);

  const { handleCallClick, hasActiveCallInChannel, isUserInCurrentChannelCall, isInCall } =
    useCallActions({
      channelId,
      callDisplayName: channelDisplayName,
    });
  const { showConfirmModal, modalContent, handleCallAction, handleConfirmCall, closeModal } =
    useCallConfirmation({
      scopeType: channel?.scopeType,
      channelName: channelDisplayName,
      participantCount: channel?.participantCount ?? 0,
      hasActiveCallInChannel,
      isUserInCurrentChannelCall,
      isInCall,
    });

  const threadCallActive = isThread && !!conversation?.callId;
  const alreadyInThisCall = !isThread && isUserInCurrentChannelCall;
  const isAlone = !isThread && (channel?.participantCount ?? 0) === 1;
  const startBlocked = threadCallActive || alreadyInThisCall || isAlone;
  const joinsExisting = !isThread && hasActiveCallInChannel && !isUserInCurrentChannelCall;

  const track = useCallback(
    (action: string): void => {
      globalClickTracker.trackManualEvent(TRACK_CATEGORY, 'ACT_ON_INTENT_SUGGESTION', action, {
        intentKey,
        action,
        surface: detection.surface,
        msShown: Date.now() - shownAt,
      });
    },
    [intentKey, detection.surface, shownAt],
  );

  const [starting, setStarting] = useState(false);
  const isConnected = useSelector(roomActor, state => state.matches('connected'));
  const sawIdleSinceStart = useRef(false);
  const sawAttempt = useRef(false);

  const resetStart = useCallback((message: string): void => {
    setStarting(false);
    sawIdleSinceStart.current = false;
    sawAttempt.current = false;
    toast.error(message);
  }, []);

  useEffect(() => {
    if (!starting) return;
    if (isConnected && sawIdleSinceStart.current) {
      dismissIntentCallSuggestion(detection.messageId);
      return;
    }
    if (isInCall) {
      if (sawIdleSinceStart.current) sawAttempt.current = true;
      return;
    }
    if (sawAttempt.current) {
      resetStart("Couldn't start the call. Please try again.");
      return;
    }
    sawIdleSinceStart.current = true;
  }, [starting, isInCall, isConnected, detection.messageId, resetStart]);

  useEffect(() => {
    if (!starting) return;
    const timer = setTimeout(
      () => resetStart("The call didn't start. Please try again."),
      START_TIMEOUT_MS,
    );
    return (): void => clearTimeout(timer);
  }, [starting, resetStart]);

  const placeCall = useCallback((): void => {
    if (isSdlcSurface) {
      dismissIntentCallSuggestion(detection.messageId);
    } else {
      sawIdleSinceStart.current = !isInCall;
      sawAttempt.current = false;
      setStarting(true);
    }
    handleCallClick();
  }, [handleCallClick, isInCall, detection.messageId]);

  const confirmStart = useCallback(
    (): void => handleConfirmCall(placeCall),
    [handleConfirmCall, placeCall],
  );

  const onStartCall = (): void => {
    track(joinsExisting ? 'Join call' : 'Start call');
    if (isThread) {
      setPickerOpen(true);
      return;
    }
    handleCallAction(placeCall);
  };

  const onSchedule = (): void => {
    track('Schedule');
    setScheduleOpen(true);
  };

  const onDismiss = (): void => {
    globalClickTracker.trackManualEvent(TRACK_CATEGORY, 'SUGGESTION_DISMISSED', undefined, {
      intentKey,
      reason: 'closed',
      surface: detection.surface,
      msShown: Date.now() - shownAt,
    });
    dismissIntentCallSuggestion(detection.messageId);
  };

  const title = isThread ? 'Start a thread call' : 'Start a call in this channel';
  const startLabel = starting ? 'Starting…' : joinsExisting ? 'Join call' : 'Start call';
  const startDisabled = startBlocked || starting;

  return (
    <div className='mt-3 flex flex-col items-start gap-3' data-testid='intent-call-suggestion'>
      <button
        type='button'
        onClick={toggleExpanded}
        aria-expanded={expanded}
        data-track-category='INTENT_SUGGESTION'
        data-track-name='TOGGLE_INTENT_SUGGESTION'
        data-track-metadata={JSON.stringify({ intentKey, surface: detection.surface })}
        className='inline-flex h-8 items-center gap-1.5 rounded-lg border bg-background px-3 text-sm text-foreground/80 transition-colors hover:bg-accent hover:text-foreground'
      >
        <SparkleAi01 className='size-4 text-primary' />1 Suggestion
      </button>

      {expanded && (
        <div className='w-full max-w-[640px] rounded-2xl border bg-background px-5 pb-5 pt-4 shadow-sm'>
          <div className='flex items-center justify-between gap-2'>
            <span className='inline-flex items-center gap-1.5 text-sm text-muted-foreground'>
              <SparkleAi01 className='size-4 text-primary' />
              Suggested by Xyne
            </span>
            <Button
              variant='ghost'
              size='icon'
              className='-mr-2 size-7 text-muted-foreground hover:text-foreground'
              onClick={onDismiss}
              aria-label='Dismiss suggestion'
            >
              <X size={16} />
            </Button>
          </div>

          <div className='mt-2 text-base font-medium leading-6 text-foreground'>{title}</div>

          {isThread && (
            <div className='mt-1.5 flex items-center gap-2 text-sm text-muted-foreground'>
              {shownParticipantIds.length > 0 && (
                <AvatarGroup
                  userIds={shownParticipantIds}
                  size='sm'
                  count={VISIBLE_AVATARS}
                  className='shrink-0'
                />
              )}
              <span className='truncate'>{participantsLabel}</span>
            </div>
          )}

          <div className='mt-4 flex justify-end gap-3'>
            <Button
              variant='outline'
              className='h-10 gap-2 rounded-lg px-4 text-sm font-medium'
              onClick={onSchedule}
            >
              <CalendarDefault size={18} />
              Schedule
            </Button>
            <Tooltip
              content={
                alreadyInThisCall
                  ? 'You are already in this call'
                  : threadCallActive
                    ? 'Call already in progress'
                    : isAlone
                      ? 'You are the only one here'
                      : startLabel
              }
            >
              <span>
                <Button
                  className={cn(
                    'h-10 gap-2 rounded-lg px-4 text-sm font-medium',
                    startDisabled && 'pointer-events-none',
                  )}
                  disabled={startDisabled}
                  onClick={onStartCall}
                >
                  <PhoneDefault size={18} />
                  {startLabel}
                </Button>
              </span>
            </Tooltip>
          </div>
        </div>
      )}

      {pickerOpen && (
        <CallParticipantsSelectionModal
          isOpen
          onClose={() => setPickerOpen(false)}
          channelId={channelId}
          conversationId={conversationId}
          onCallInitiated={() => dismissIntentCallSuggestion(detection.messageId)}
        />
      )}

      <CallConfirmationModal
        isOpen={showConfirmModal}
        onClose={closeModal}
        onConfirm={confirmStart}
        title={modalContent.title}
        subtitle={modalContent.subtitle}
        description={modalContent.description}
      />

      {scheduleOpen && (
        <ScheduleCallModal
          isOpen
          onClose={() => setScheduleOpen(false)}
          onSuccess={() => dismissIntentCallSuggestion(detection.messageId)}
          channelId={channelId}
          {...(isThread ? { conversationId } : {})}
          {...(isThread ? { initialParticipants: threadUserIds } : {})}
        />
      )}
    </div>
  );
};
