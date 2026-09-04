import { useSelector } from '@xstate/react';
import { useEffect, useRef, useMemo, useCallback } from 'react';
import { useZero } from '../../../hooks/useZero';
import { QueryResultType } from '@rocicorp/zero';
import { useAuth } from '../../../hooks/useAuth';
import { callActor } from '../../../machines/callMachine';
import { roomActor } from '../../../machines/roomMachine';
import { CallParticipant, Channel } from '@xyne/shared';
import { mutators } from '../../../zero/mutators';
import { queries } from '../../../zero/queries';
import { useAllChannels } from '../../../hooks/useChannels';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { useUsers } from '../../../hooks/useUsers';
import { IncomingCallCard } from '../IncomingCall/IncomingCallCard';
import { globalClickTracker } from '../../../services/Analytics/globalClickTracker';
import {
  buildCallNotificationBody,
  buildIncomingCallViewModel,
  isRingableCall,
  type IncomingCallRow,
} from '../IncomingCall/IncomingCallCard.utils';
import type { IncomingCallViewModel } from '../IncomingCall/IncomingCallCard.types';

type CallWithRelations = QueryResultType<typeof queries.userActiveCalls>[number];

export function IncomingCallModal(): React.ReactElement | null {
  const { user } = useAuth();
  const zero = useZero();
  const allUsers = useUsers();

  // Use selectors to get state from the call actor
  const callState = useSelector(callActor, snapshot => snapshot.value);
  const incomingCallQueue = useSelector(callActor, snapshot => snapshot.context.incomingCallQueue);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const processingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastViewModelRef = useRef<IncomingCallViewModel | null>(null);

  // Get active calls from roomActor context and filter for incoming calls (where user is invited)
  const allActiveCalls = useSelector(roomActor, state => state.context.activeCalls);
  const currentCallId = useSelector(roomActor, state => state.context.externalId); // Get current call ID
  // Get nativeActiveCallId - calls joined via VoIP notification before Zero syncs
  const nativeActiveCallId = useSelector(
    callActor,
    snapshot => snapshot.context.nativeActiveCallId,
  );

  // Check if user is currently in an active call (reactive)
  const roomState = useSelector(roomActor, state => state.value);
  const roomSnapshot = useSelector(roomActor, state => state);
  const isInActiveCall =
    roomSnapshot.matches('initiating') ||
    roomSnapshot.matches('joining') ||
    roomSnapshot.matches('connecting') ||
    roomSnapshot.matches('connected');

  // Only allow incoming call notifications in stable states (idle or connected)
  const canShowIncomingCalls =
    roomState === 'idle' || (typeof roomState === 'object' && 'connected' in roomState);

  const allChannels = useAllChannels();
  const channelMap = useMemo(() => {
    const map = new Map<string, Channel>();
    allChannels.forEach(ch => map.set(ch.id, ch));
    return map;
  }, [allChannels]);

  // Lookup shared by the dispatcher below and by the view-model builder.
  const usersById = useMemo(() => new Map(allUsers.map(u => [u.id, u])), [allUsers]);

  // Which active calls should ring this user. The rules themselves live in
  // isRingableCall so that loosening them is a change in exactly one place —
  // the card renders correctly for calls they currently reject.
  const incomingCalls = allActiveCalls?.filter(call => {
    const callWithRelations = call as CallWithRelations;
    return isRingableCall({
      call: callWithRelations as unknown as IncomingCallRow,
      channel: call.channelId ? channelMap.get(call.channelId) : undefined,
      myParticipant: callWithRelations.participants?.find(
        (p: CallParticipant) => p.userId === user?.id,
      ),
      currentCallId,
      nativeActiveCallId,
      now: Date.now(),
    });
  });

  useEffect(() => {
    // Clear any existing timeout
    if (processingTimeoutRef.current) {
      clearTimeout(processingTimeoutRef.current);
    }

    // Debounce processing incoming calls to allow state transitions to complete
    processingTimeoutRef.current = setTimeout(() => {
      // Only process incoming calls when in stable states (not during transitions)
      if (!canShowIncomingCalls) return;

      if (!incomingCalls?.length) return;

      incomingCalls.forEach(call => {
        const callId = String(call.externalId);
        const callWithRelations = call as CallWithRelations;

        // Find current user's participant record to get who invited them
        const userParticipant = callWithRelations.participants?.find(
          (p: CallParticipant) => p.userId === user?.id,
        );

        // Use the inviter instead of the original call creator
        const inviterUserId = userParticipant?.invitedBy ?? callWithRelations.createdByUserId ?? '';
        const inviterUser = inviterUserId ? usersById.get(inviterUserId) : undefined;

        const callData = {
          callId,
          caller: {
            id: inviterUserId ?? '',
            name: getUserDisplayName(inviterUser),
            email: inviterUser?.email ?? '',
            picture: inviterUser?.picture ?? '',
          },
          callType: call.callType,
        };

        callActor.send({
          type: 'INCOMING_CALL',
          callData,
        });
      });
    }, 500); // 500ms delay to allow state transitions to complete

    return (): void => {
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
      }
    };
  }, [incomingCalls, incomingCallQueue, canShowIncomingCalls, user?.id]);

  // The caller hanging up removes the call from activeCalls. Tear the modal
  // down on that change rather than inside the debounce below — half a second
  // of a card for a call that has already ended reads as an unresponsive UI,
  // and the debounce exists to settle calls *arriving*, not leaving.
  const ringingCallId = incomingCallQueue[0]?.callId;
  const ringableIdsKey = (incomingCalls ?? [])
    .map(call => String(call.externalId))
    .sort()
    .join(',');

  const hasLoadedActiveCalls = allActiveCalls !== undefined;

  useEffect(() => {
    if (!ringingCallId) return;
    // An empty list because the query has not loaded is not the same as a call
    // that ended — concluding otherwise would hang up on a live caller.
    if (!hasLoadedActiveCalls) return;
    if (ringableIdsKey.split(',').includes(ringingCallId)) return;
    callActor.send({ type: 'REJECT' });
  }, [ringingCallId, ringableIdsKey, hasLoadedActiveCalls]);

  // Initialize audio once
  useEffect(() => {
    audioRef.current = new Audio('/sounds/call_ringtone.mp3');
    audioRef.current.loop = true;

    return (): void => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
    };
  }, []);

  // Check if we're in the ringing state (simplified)
  const isRinging = callState === 'ringing';

  // Get the first call in the queue (active incoming call)
  const incomingCallData = incomingCallQueue[0];

  // Play notification sound when incoming call appears
  useEffect(() => {
    const shouldPlay = isRinging && incomingCallData;

    if (shouldPlay && audioRef.current) {
      audioRef.current.currentTime = 0;
      void audioRef.current.play().catch(() => {
        // Silently handle audio play failures
      });
    } else if (!shouldPlay && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, [isRinging, incomingCallData]);

  const handleAcceptCall = useCallback(
    (callIdToAccept?: string): void => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }

      // Close the native notification if in Electron
      if (
        window.electronAPI &&
        callIdToAccept &&
        typeof window.electronAPI.closeCallNotification === 'function'
      ) {
        window.electronAPI.closeCallNotification(callIdToAccept);
      }

      if (isInActiveCall) {
        // Send SWITCH_CALL event to disconnect current call and join new one
        callActor.send({ type: 'SWITCH_CALL', zero });
      } else {
        // Normal accept flow
        callActor.send({ type: 'ACCEPT', zero });
      }
    },
    [isInActiveCall, zero],
  );

  const handleRejectCall = useCallback(
    (callIdToReject?: string): void => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }

      // Close the native notification if in Electron
      if (
        window.electronAPI &&
        callIdToReject &&
        typeof window.electronAPI.closeCallNotification === 'function'
      ) {
        window.electronAPI.closeCallNotification(callIdToReject);
      }

      // Call Zero mutator directly to update database
      const callId = callIdToReject ?? incomingCallData?.callId;
      if (zero && callId) {
        void zero.mutate(mutators.calls.reject({ callId, timestamp: Date.now() }));
      }

      // Update UI state
      callActor.send({ type: 'REJECT' });
    },
    [zero, incomingCallData?.callId],
  );

  // Derive the OS-notification body from the same view model the modal renders,
  // so it says the same thing the in-app card would: scheduled calls name the
  // place, everything else reads as `<inviter> is inviting you to a call`.
  // Memoized so the notification effect below only re-runs when the *text*
  // actually changes -- not on every workspace-wide Zero sync that touches
  // allActiveCalls / channelMap / usersById while a call is ringing.
  const notificationBody = useMemo((): string | null => {
    if (!incomingCallData) {
      return null;
    }
    const latestCallData = allActiveCalls?.find(
      call => call.externalId === incomingCallData.callId,
    ) as CallWithRelations | undefined;
    const vm = buildIncomingCallViewModel({
      callId: incomingCallData.callId,
      call: latestCallData as unknown as IncomingCallRow | undefined,
      caller: incomingCallData.caller,
      channelMap,
      usersById,
      currentUserId: user?.id,
      isInActiveCall,
    });
    return buildCallNotificationBody(vm, incomingCallData.caller.name);
  }, [incomingCallData, allActiveCalls, channelMap, usersById, user?.id, isInActiveCall]);

  // Show native Electron notification when app is in background. Keyed on the
  // ring state, the (reference-stable) incoming call, and the derived body, so
  // the notification fires once per call and re-shows only when the body
  // actually changes -- instead of being torn down and recreated (replaying the
  // ring sound / dock bounce) on every unrelated participant/user/channel sync.
  useEffect(() => {
    if (
      !window.electronAPI ||
      !isRinging ||
      !incomingCallData ||
      notificationBody === null ||
      typeof window.electronAPI.showCallNotification !== 'function'
    ) {
      return;
    }

    window.electronAPI.showCallNotification({
      callId: incomingCallData.callId,
      callerName: incomingCallData.caller.name,
      callerEmail: incomingCallData.caller.email,
      callType: incomingCallData.callType,
      body: notificationBody,
      ...(incomingCallData.caller.picture && { callerPicture: incomingCallData.caller.picture }),
    });

    return (): void => {
      if (window.electronAPI && typeof window.electronAPI.closeCallNotification === 'function') {
        window.electronAPI.closeCallNotification(incomingCallData.callId);
      }
    };
  }, [isRinging, incomingCallData, notificationBody]);

  // Handle Electron notification action callbacks (accept/reject from notification)
  useEffect(() => {
    if (
      !window.electronAPI ||
      typeof window.electronAPI.onCallAction !== 'function' ||
      typeof window.electronAPI.onCallNotificationClicked !== 'function'
    ) {
      return;
    }

    const cleanupCallAction = window.electronAPI.onCallAction(
      (data: { callId: string; action: 'accept' | 'reject' }) => {
        // Find the call in the queue
        const callInQueue = incomingCallQueue.find(call => call.callId === data.callId);
        if (!callInQueue) return;

        if (data.action === 'accept') {
          globalClickTracker.trackManualEvent('CALLS', 'ACCEPT_INCOMING_CALL_NATIVE');
          handleAcceptCall(data.callId);
        } else if (data.action === 'reject') {
          globalClickTracker.trackManualEvent('CALLS', 'REJECT_INCOMING_CALL_NATIVE');
          handleRejectCall(data.callId);
        }
      },
    );

    // Register for notification clicks - window focusing is handled by Electron main process
    const cleanupNotificationClicked = window.electronAPI.onCallNotificationClicked(() => {});

    return (): void => {
      cleanupCallAction();
      cleanupNotificationClicked();
    };
  }, [incomingCallQueue, handleAcceptCall, handleRejectCall]);

  // Show incoming call modal when in ringing state
  if (isRinging && incomingCallData) {
    // Read the live row rather than the queued snapshot: the roster changes as
    // people join or decline, and an ad-hoc thread call's title is written by
    // an LLM a beat *after* the phone starts ringing. Both reach the card on
    // their own through Zero.
    const latestCallData = allActiveCalls?.find(
      call => call.externalId === incomingCallData.callId,
    ) as CallWithRelations | undefined;

    const built = buildIncomingCallViewModel({
      callId: incomingCallData.callId,
      call: latestCallData as unknown as IncomingCallRow | undefined,
      caller: incomingCallData.caller,
      channelMap,
      usersById,
      currentUserId: user?.id,
      isInActiveCall,
    });

    // Two things happen in the beat between the caller hanging up and this
    // modal unmounting: the call leaves activeCalls, and every participant row
    // picks up a `leftAt`. Rebuilt from either, a group call collapses into a
    // lone pinging avatar — so the card is pinned to the last good version of
    // itself, and a stack is never allowed to become a solo mid-ring.
    const previous =
      lastViewModelRef.current?.callId === incomingCallData.callId
        ? lastViewModelRef.current
        : null;

    let vm = built;
    if (previous) {
      if (!latestCallData) {
        vm = { ...previous, isInActiveCall };
      } else if (previous.identity.mode === 'stack' && built.identity.mode === 'solo') {
        vm = { ...built, identity: previous.identity };
      }
    }
    lastViewModelRef.current = vm;

    return (
      <IncomingCallCard
        vm={vm}
        onAccept={() => handleAcceptCall(incomingCallData.callId)}
        onReject={() => handleRejectCall(incomingCallData.callId)}
      />
    );
  }

  return null;
}
