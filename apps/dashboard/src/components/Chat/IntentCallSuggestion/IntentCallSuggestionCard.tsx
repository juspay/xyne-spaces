/**
 * Inline "Suggested by Xyne" card under a message the on-device classifier read as
 * a wish to talk ("can we hop on a call?"). Local to the sender's device — the
 * detection never leaves it and nobody else sees the card.
 *
 * Two shapes, picked by the composer the message came from (IntentDetection.surface):
 *   thread  → "Start a thread call" listing the thread's participants, the same
 *             set CallParticipantsSelectionModal pre-selects.
 *   channel → "Start a call in this channel", no participant row: a channel call
 *             rings the room, so naming its members adds noise, not information.
 *             Same call the header's phone button starts.
 *
 * Public channels only — the classifier never sees a private channel or DM
 * message (see intentClassifier.isEligible), so there is no DM branch here.
 *
 * Start call starts it right here; Schedule opens the usual Schedule Call modal
 * with the same people prefilled. Everything goes through the hooks the header
 * and thread buttons already use, so an active call, the "switch calls?" prompt
 * and the SDLC frame bridge all behave as they do there.
 *
 * The card stays mounted until the call is actually connected: both call hooks
 * keep their "disconnect, then start" step in a ref, so unmounting on click
 * would drop a pending switch on the floor.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDefault, PhoneDefault, SparkleAi01 } from '@xyne/icons';
import { X } from 'lucide-react';
import { Button } from '../../ui/Button';
import AvatarGroup from '../../ui/Avatar/AvatarGroup';
import Tooltip from '../../ui/Tooltip';
import { CallConfirmationModal } from '../../Call/CallConfirmationModal';
import { ScheduleCallModal } from '../../Call/ScheduleCallModal/ScheduleCallModal';
import { useAuth } from '../../../hooks/useAuth';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useCallActions } from '../../../hooks/useCallActions';
import { useCallConfirmation } from '../../../hooks/useCallConfirmation';
import { useCallJoinOrInitiate } from '../../../hooks/useCallJoinOrInitiate';
import { useChannel } from '../../../hooks/useChannels';
import { useChannelDisplayName } from '../../../hooks/useChannelDisplayName';
import { useUsersById } from '../../../hooks/useUsers';
import { queries } from '../../../zero/queries';
import { globalClickTracker } from '../../../services/Analytics/globalClickTracker';
import type { IntentDetection } from '../../../services/onDeviceIntent';
import { dismissIntentCallSuggestion } from '../../../stores/intentCallSuggestionStore';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { cn } from '../../../utils/classNames';

interface IntentCallSuggestionCardProps {
  detection: IntentDetection;
  channelId: string;
  /** The message's own conversation — the thread, when `detection.surface` is 'thread'. */
  conversationId: string;
}

/** How many names to spell out before "+N". Matches the avatar stack. */
const NAMED_PARTICIPANTS = 3;

const TRACK_CATEGORY = 'INTENT_SUGGESTION';

export const IntentCallSuggestionCard: React.FC<IntentCallSuggestionCardProps> = ({
  detection,
  channelId,
  conversationId,
}) => {
  const isThread = detection.surface === 'thread';
  const { user: currentUser } = useAuth();
  const currentUserId = currentUser?.id ?? '';
  const channel = useChannel(channelId);
  const { displayName: channelDisplayName } = useChannelDisplayName(channel, currentUserId);
  const usersById = useUsersById();

  const [expanded, setExpanded] = useState(true);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // Impression and dismissal share a clock so msShown means the same thing it
  // does for the toast variant.
  const [shownAt] = useState(() => Date.now());
  const intentKey = detection.intentId;

  React.useEffect(() => {
    globalClickTracker.trackManualEvent(TRACK_CATEGORY, 'SUGGESTION_SHOWN', undefined, {
      intentKey,
      hasAction: true,
      surface: detection.surface,
    });
  }, [intentKey, detection.surface]);

  // --- who gets called -------------------------------------------------------

  const [conversation] = useCachedQuery(queries.getConversationById({ conversationId }), {
    enabled: isThread,
  });
  // Thread participants, others only — self is added back when the call is
  // placed, and "you" in the avatar row says nothing. Same rule as
  // CallParticipantsSelectionModal: only people who authored or were mentioned,
  // not those auto-added by read tracking.
  const threadUserIds = useMemo((): string[] => {
    if (!isThread) return [];
    return (conversation?.participants ?? [])
      .filter(p => p.participationType !== null && p.participationType !== undefined)
      .map(p => p.userId)
      .filter(id => id !== currentUserId);
  }, [isThread, conversation?.participants, currentUserId]);

  const participantsLabel = useMemo((): string => {
    const names = threadUserIds
      .map(id => {
        const u = usersById.get(id);
        return u ? getUserDisplayName(u) : null;
      })
      .filter((n): n is string => !!n);
    if (names.length === 0) return 'Just you so far';
    const named = names.slice(0, NAMED_PARTICIPANTS).join(', ');
    const rest = names.length - NAMED_PARTICIPANTS;
    return `${named}${rest > 0 ? ` +${rest}` : ''} from this thread`;
  }, [threadUserIds, usersById]);

  // --- starting the call -------------------------------------------------------

  // A channel call rings the room, so it carries no explicit targets.
  const targetUserIds = useMemo(
    (): string[] | undefined => (isThread ? [...threadUserIds, currentUserId] : undefined),
    [isThread, threadUserIds, currentUserId],
  );

  const { initiateCall } = useCallJoinOrInitiate();
  const { handleCallClick, hasActiveCallInChannel, isUserInCurrentChannelCall, isInCall } =
    useCallActions({
      channelId,
      targetUserIds,
      callDisplayName: channelDisplayName,
      ...(isThread && { conversationId }),
    });
  // The card is already the confirmation, so skip "Start a call in this
  // channel?" and keep only the "switch calls?" prompt when already in one.
  const { showConfirmModal, modalContent, handleCallAction, handleConfirmCall, closeModal } =
    useCallConfirmation({
      scopeType: channel?.scopeType,
      channelName: channelDisplayName,
      participantCount: channel?.participantCount ?? 0,
      hasActiveCallInChannel,
      isUserInCurrentChannelCall,
      isInCall,
      onlyShowSwitchModal: true,
    });

  const threadCallActive = isThread && !!conversation?.callId;
  // handleCallClick toggles: in this channel's call it would LEAVE. Not from here.
  const alreadyInThisCall = !isThread && isUserInCurrentChannelCall;
  const callInProgress = threadCallActive || alreadyInThisCall;
  // Channel-side: a live channel call makes this a join, which handleCallClick
  // already does; the label says so.
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

  // Set when the call has been asked for; the effect below removes the card once
  // the room machine reports a live call that began after that point.
  const [starting, setStarting] = useState(false);
  const sawIdleSinceStart = useRef(false);
  useEffect(() => {
    if (!starting) return;
    if (!isInCall) {
      // Either we were idle to begin with, or the old call has been dropped
      // ahead of the switch. Either way the next connect is ours.
      sawIdleSinceStart.current = true;
      return;
    }
    if (sawIdleSinceStart.current) dismissIntentCallSuggestion(detection.messageId);
  }, [starting, isInCall, detection.messageId]);

  const placeCall = useCallback((): void => {
    setStarting(true);
    if (isThread) {
      initiateCall({
        channelId,
        conversationId,
        ...(targetUserIds && targetUserIds.length > 0 && { targetUserIds }),
        callDisplayName: channelDisplayName,
      });
      return;
    }
    handleCallClick();
  }, [
    isThread,
    initiateCall,
    channelId,
    conversationId,
    targetUserIds,
    channelDisplayName,
    handleCallClick,
  ]);

  const onStartCall = (): void => {
    track(joinsExisting ? 'Join call' : 'Start call');
    // Runs placeCall now, or after the "switch calls?" prompt is confirmed.
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
  const startDisabled = callInProgress || starting;

  return (
    <div className='mt-3 flex flex-col items-start gap-3' data-testid='intent-call-suggestion'>
      <button
        type='button'
        onClick={() => setExpanded(v => !v)}
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
              {threadUserIds.length > 0 && (
                <AvatarGroup userIds={threadUserIds} size='sm' count={4} className='shrink-0' />
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

      <CallConfirmationModal
        isOpen={showConfirmModal}
        onClose={closeModal}
        onConfirm={() => handleConfirmCall(placeCall)}
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
