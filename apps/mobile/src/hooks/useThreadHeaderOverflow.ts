import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import { requestRecordingPermissionsAsync } from 'expo-audio';
import { useChannel } from '@/src/hooks/useChannels';
import { useRecordingStore, sendRecordingAction } from '@/src/hooks/useRecordingStore';
import { getRecordingState } from '@/src/stores/recordingStore';
import { roomActor } from '@/src/machines/roomMachine';
import { Alert } from 'react-native';
import { v4 as uuidv4 } from 'uuid';

import {
  getThreadCallBlockReason,
  getThreadHeaderOverflowActions,
  shouldBlockSubscriptionToggle,
  type ThreadHeaderOverflow,
  type ThreadHeaderOverflowActionId,
} from '@/src/features/chat/thread-header/thread-header-overflow';
import { useRoomSelector, useIsInCall } from '@/src/hooks/useRoomMachine';
import { useQuery } from '@/src/hooks/useQuery';
import { useZero } from '@/src/hooks/useZero';
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
  const currentCallChannelId = useRoomSelector(state => state.channelId);
  const currentConversationId = useRoomSelector(state => state.conversationId);
  const channel = useChannel(channelId);
  const canEdit = Boolean(channel && !channel.isArchived && canUseMemberActions && threadId);
  const recordingStatus = useRecordingStore(state => state.status);
  const recordingError = useRecordingStore(state => state.error);
  const recordingActive = recordingStatus !== 'idle' && recordingStatus !== 'error';
  const startedRecording = useRef(false);
  const requestingMic = useRef(false);
  const [isContextOpen, setIsContextOpen] = useState(false);
  const [isCallOpen, setIsCallOpen] = useState(false);
  const closeContext = useCallback(() => setIsContextOpen(false), []);
  const closeCall = useCallback(() => setIsCallOpen(false), []);
  const [isTagsOpen, setIsTagsOpen] = useState(false);
  const closeTags = useCallback(() => setIsTagsOpen(false), []);
  useEffect(() => {
    if (startedRecording.current && recordingStatus === 'error') {
      startedRecording.current = false;
      Alert.alert('Could not start recording', recordingError ?? 'Please try again.');
    }
  }, [recordingStatus, recordingError]);

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
  const actions = useMemo(
    () =>
      getThreadHeaderOverflowActions(isSubscribed, {
        canEdit,
        recordingActive,
        recordingStarting: recordingStatus === 'starting' || recordingStatus === 'stopping',
      }).map(action =>
        action.id === 'start-call' ? { ...action, disabled: !canEdit || recordingActive } : action,
      ),
    [isSubscribed, canEdit, recordingActive, recordingStatus],
  );

  const handleTakeNotes = useCallback(async () => {
    if (recordingActive) {
      router.push('/(protected)/(shortcuts)/recordings');
      return;
    }
    if (!canEdit || requestingMic.current) return;
    if (isInCall) {
      Alert.alert('Already in a call', 'Please leave your call before taking notes.');
      return;
    }
    requestingMic.current = true;
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Microphone access needed',
          'Allow microphone access in Settings to take notes.',
        );
        return;
      }
      const status = getRecordingState().status;
      // Permission prompts yield control; another recording or call may have started.
      if (
        (status !== 'idle' && status !== 'error') ||
        (['initiating', 'joining', 'connecting', 'connected', 'disconnecting'] as const).some(
          state => roomActor.getSnapshot().matches(state),
        )
      )
        return;
      startedRecording.current = true;
      sendRecordingAction({ type: 'clearTranscripts' });
      sendRecordingAction({ type: 'startRecording', channelId, conversationId: threadId });
    } catch (error) {
      Alert.alert(
        'Could not start recording',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      requestingMic.current = false;
    }
  }, [canEdit, channelId, threadId, recordingActive, isInCall]);

  const handleStartCall = useCallback(() => {
    if (!canEdit || recordingActive) return;
    const blockReason = getThreadCallBlockReason({
      canUseMemberActions,
      isInCall,
      currentCallChannelId,
      currentConversationId,
      threadId,
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

    if (isInCall) {
      router.push('/(protected)/native-call');
      return;
    }
    setIsCallOpen(true);
  }, [
    canEdit,
    recordingActive,
    canUseMemberActions,
    channelId,
    threadId,
    currentConversationId,
    currentCallChannelId,
    isInCall,
  ]);

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
      if (id === 'add-context') {
        if (canEdit) setIsContextOpen(true);
        return;
      }
      if (id === 'take-notes') {
        void handleTakeNotes();
        return;
      }
      if (id === 'thread-tags') {
        if (canEdit) setIsTagsOpen(true);
        return;
      }
      if (id === 'start-call') {
        handleStartCall();
        return;
      }

      if (id === 'toggle-subscription') {
        handleToggleSubscription();
        return;
      }
    },
    [handleStartCall, handleToggleSubscription, handleTakeNotes, canEdit],
  );

  return {
    isContextOpen,
    closeContext,
    isCallOpen,
    closeCall,
    isTagsOpen,
    closeTags,
    actions,
    isSubscribed,
    isSubscriptionResolving,
    handleAction,
  };
}
