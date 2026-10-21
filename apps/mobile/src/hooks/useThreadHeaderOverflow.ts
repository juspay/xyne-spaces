import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { v4 as uuidv4 } from 'uuid';

import {
  getThreadCallBlockReason,
  getThreadHeaderOverflowActions,
  shouldBlockSubscriptionToggle,
  type ThreadHeaderOverflow,
  type ThreadHeaderOverflowActionId,
} from '@/src/features/chat/thread-header/thread-header-overflow';
import { useCurrentCallExternalId, useIsInCall } from '@/src/hooks/useRoomMachine';
import { useQuery } from '@/src/hooks/useQuery';
import { useZero } from '@/src/hooks/useZero';
import { startAudioCall } from '@/src/utils/startAudioCall';
import { awaitMutation } from '@/src/zero/awaitMutation';
import { mutators } from '@/src/zero/mutators';
import { queries } from '@/src/zero/queries';

export function useThreadHeaderOverflow(
  channelId: string,
  threadId: string,
  canUseMemberActions: boolean,
): ThreadHeaderOverflow {
  const zero = useZero();
  const isInCall = useIsInCall();
  const currentCallExternalId = useCurrentCallExternalId();

  const [participant, participantDetails] = useQuery(
    queries.conversationParticipantByConversationId({
      conversationId: threadId,
    }),
    {
      enabled: Boolean(threadId),
    },
  );

  const isSubscribed = useMemo(() => participant?.isSubscribed ?? false, [participant]);
  const isSubscriptionQueryResolving = useMemo(() => {
    return participantDetails?.type !== 'complete';
  }, [participantDetails]);
  const [isSubscriptionMutating, setIsSubscriptionMutating] = useState(false);
  const subscriptionMutationInFlightRef = useRef(false);
  const isSubscriptionResolving = isSubscriptionQueryResolving || isSubscriptionMutating;
  const actions = useMemo(() => getThreadHeaderOverflowActions(isSubscribed), [isSubscribed]);

  const handleStartCall = useCallback(() => {
    const blockReason = getThreadCallBlockReason({
      canUseMemberActions,
      isInCall,
      currentCallExternalId,
      channelId,
    });
    if (blockReason === 'join-channel') {
      Alert.alert('Join channel', 'Join this channel before starting a call.');
      return;
    }
    if (blockReason === 'already-in-call') {
      Alert.alert('Already in a call', 'Please leave your current call before starting a new one.');
      return;
    }

    void startAudioCall(channelId);
  }, [canUseMemberActions, channelId, currentCallExternalId, isInCall]);

  const handleToggleSubscription = useCallback(() => {
    if (
      shouldBlockSubscriptionToggle({
        threadId,
        isQueryResolving: isSubscriptionQueryResolving,
        isMutating: isSubscriptionMutating,
        mutationInFlight: subscriptionMutationInFlightRef.current,
      })
    ) {
      return;
    }

    subscriptionMutationInFlightRef.current = true;
    setIsSubscriptionMutating(true);

    const mutation = isSubscribed
      ? zero.mutate(
          mutators.conversations.unsubscribeFromConversation({
            conversationId: threadId,
          }),
        )
      : zero.mutate(
          mutators.conversations.subscribeToConversation({
            conversationId: threadId,
            timestamp: Date.now(),
            participantId: uuidv4(),
          }),
        );

    void awaitMutation(mutation)
      .catch(() => {
        Alert.alert(
          'Could not update notifications',
          'Try again in a moment. Your subscription was not changed.',
        );
      })
      .finally(() => {
        subscriptionMutationInFlightRef.current = false;
        setIsSubscriptionMutating(false);
      });
  }, [isSubscribed, isSubscriptionMutating, isSubscriptionQueryResolving, threadId, zero]);

  const handleAction = useCallback(
    (id: ThreadHeaderOverflowActionId) => {
      if (id === 'start-call') {
        handleStartCall();
        return;
      }

      if (id === 'toggle-subscription') {
        handleToggleSubscription();
        return;
      }
    },
    [handleStartCall, handleToggleSubscription],
  );

  return {
    actions,
    isSubscribed,
    isSubscriptionResolving,
    handleAction,
  };
}
