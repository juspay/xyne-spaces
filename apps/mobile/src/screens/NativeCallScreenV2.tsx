/**
 * NativeCallScreen using roomMachine
 *
 * This version uses the XState roomMachine as the single source of truth
 * for all call state management, replacing manual state handling.
 *
 * Visual layers (see src/components/call): CallBackdrop → CallStage (tiles) → header /
 * control bar / banners → sheets. This file only orchestrates state and navigation.
 */
import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import {
  NativeModules,
  type HostComponent,
  Platform,
  Share,
  StatusBar,
  StyleSheet,
  View,
  findNodeHandle,
} from 'react-native';
import { ScreenCapturePickerView } from '@livekit/react-native-webrtc';
import { useNavigation, usePreventRemove } from 'expo-router/react-navigation';
import { useRawSafeAreaInsets } from '@/src/hooks/useRawSafeAreaInsets';
import { useRouter } from 'expo-router';

import { LiveKitRoomProvider } from '@/src/components/call';
import { CallScreenLayout } from '@/src/components/call/CallScreenLayout';
import { CallStage, type StageSummary } from '@/src/components/call/CallStage';
import { CallConnectingView } from '@/src/components/call/CallConnectingView';
import { CallConnectionBanner } from '@/src/components/call/ConnectionBanner';
import { CallMoreSheet } from '@/src/components/call/CallMoreSheet';
import { AiControlRequestSheet } from '@/src/components/call/AiControlRequestSheet';
import { WaitingForOthers } from '@/src/components/call/WaitingForOthers';
import { ParticipantsDrawer } from '@/src/components/call/ParticipantsDrawer';
import { InviteUserDrawer } from '@/src/components/call/InviteUserDrawer';
import { EndCallDrawer } from '@/src/components/call/EndCallDrawer';
import { useAudioOutput } from '@/src/components/call/hooks/useAudioOutput';
import { useCallPresence, type CallPresence } from '@/src/components/call/hooks/useCallPresence';
import { useChromeVisibility } from '@/src/components/call/hooks/useChromeVisibility';
import { useRoomConnectionState } from '@/src/components/call/hooks/useRoomConnectionState';
import { getCallTalkStart, markCallTalkStart } from '@/src/components/call/callTalkClock';
import { useKeepScreenAwake } from '@/src/components/call/hooks/useKeepScreenAwake';
import { callColors, callLayout } from '@/src/components/call/callTheme';
import { isAiAgentIdentity } from '@/src/components/call/callIdentity';
import {
  filterAgentIdentities,
  getControlBarOffset,
  resolveCallStatus,
} from '@/src/components/call/callStage.utils';
import { useAuth } from '@/src/contexts/AuthContext';
import { callService } from '@/src/services/Call/callService';
import { CallType, AI_MESSAGE_TYPES, AI_DATA_TOPIC } from '@xyne/shared';
import { callKitService } from '@/src/services/CallKitService';
import { callRuntimeNativeService } from '@/src/services/CallRuntimeNativeService';
import { useQuery } from '@/src/hooks/useQuery';
import { queries } from '@/src/zero/queries';
import { useRoomMachine } from '@/src/hooks/useRoomMachine';
import { roomActor } from '@/src/machines/roomMachine';
import { clearAcceptedCallTracking } from '@/src/notifications';
import CallNotificationDataModule from '@/src/modules/CallNotificationDataModule';
import { PUBLIC_DEEP_LINK_ORIGIN } from '@/src/config';
import { tabRoute } from '@/src/navigation/routes';
import { errorMessage, logCallAction } from '@/src/services/Call/callActionLog';
import {
  createChatOpenIntent,
  executeChatOpenIntent,
} from '@/src/features/chat/navigation/chatOpenIntent';

interface NativeCallScreenProps {
  channelId: string;
  callType?: CallType;
  shouldInitiateCall?: boolean;
  isAlreadyConnected?: boolean;
  initialMicrophoneEnabled?: boolean;
  initialCameraEnabled?: boolean;
}

const NativeCallScreenContent: React.FC<{
  callId: string;
  onDisconnect: () => void;
  onBack: () => void;
  /** Minimises the call and opens its conversation; absent when the call has none. */
  onOpenChat?: (() => void) | undefined;
  isHost: boolean;
  presence: CallPresence;
}> = ({ callId, onDisconnect, onBack, onOpenChat, isHost, presence }) => {
  const insets = useRawSafeAreaInsets();

  // The room drives LiveKitRoomProvider, which the stage's LiveKit hooks read from.
  const room = callRuntimeNativeService.getRoom();
  // Real LiveKit state — the machine's copy folds "reconnecting" into "connecting" in native mode.
  const connectionState = useRoomConnectionState(room);
  // When this device joined the room; an older talk-clock entry belongs to a previous stay.
  const sessionStartMs = callRuntimeNativeService.getActiveCall()?.startedAt ?? 0;

  // Get state from roomMachine
  const {
    participants,
    isMicrophoneEnabled,
    isCameraEnabled,
    isScreenShareEnabled,
    isAIAssistantEnabled,
    aiController,
    pendingControlRequest,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    toggleAIAssistant,
    approveControlRequest,
    denyControlRequest,
  } = useRoomMachine();

  // UI State (local to this component)
  const [isParticipantsOpen, setIsParticipantsOpen] = useState(false);
  const [isInviteDrawerOpen, setIsInviteDrawerOpen] = useState(false);
  const [isEndCallDrawerOpen, setIsEndCallDrawerOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [stageSummary, setStageSummary] = useState<StageSummary>({
    mode: 'solo',
    immersive: false,
    heroIdentity: null,
    hasRemoteHuman: false,
  });
  // Set the first time somebody else is in the call: WhatsApp-style, the clock starts at answer.
  // Remembered per call outside React so minimising and returning doesn't restart it.
  const [talkStartMs, setTalkStartMs] = useState<number | null>(() =>
    getCallTalkStart(callId, sessionStartMs),
  );

  // ScreenCapturePickerViewManager.show(reactTag) can find it and
  // programmatically press the RPSystemBroadcastPickerView button.
  const screenCaptureRef = useRef<React.ElementRef<HostComponent<unknown>>>(null);

  const audio = useAudioOutput();
  const localParticipantId = participants.find(p => p.isLocal)?.identity;
  const remoteHumanCount = participants.filter(
    p => !p.isLocal && !isAiAgentIdentity(p.identity),
  ).length;

  // Same visibility rule as the stage: the AI agent isn't counted or listed until it is invoked.
  const visibleParticipants = useMemo(
    () => filterAgentIdentities(participants, !!aiController),
    [participants, aiController],
  );

  useEffect(() => {
    if (remoteHumanCount > 0 && talkStartMs === null)
      setTalkStartMs(markCallTalkStart(callId, sessionStartMs));
  }, [callId, remoteHumanCount, sessionStartMs, talkStartMs]);

  // You hold the AI and someone else asked for it: you get the approve / deny sheet.
  const isControlRequestSheetOpen =
    !!pendingControlRequest &&
    pendingControlRequest.requesterId !== localParticipantId &&
    aiController?.id === localParticipantId;

  // ── Chrome (header + control bar) ─────────────────────────────────────────
  const sheetOpen =
    isParticipantsOpen ||
    isInviteDrawerOpen ||
    isEndCallDrawerOpen ||
    isMoreOpen ||
    isControlRequestSheetOpen;
  const chromeHold = sheetOpen || connectionState !== 'connected';
  const chrome = useChromeVisibility({ immersive: stageSummary.immersive, hold: chromeHold });

  // Video on screen: don't let the display lock underneath it.
  useKeepScreenAwake(
    isCameraEnabled || stageSummary.immersive || stageSummary.mode === 'screenShare',
  );

  // ── Status line ───────────────────────────────────────────────────────────
  // Ring labels come only from the backend's ringStatus (dashboard rule); see callRoster.utils.
  const ringStatus = presence.ringing[0]?.ringStatus ?? null;
  const status = useMemo(
    () =>
      resolveCallStatus({
        phase: 'connected',
        connectionState,
        remoteHumanCount,
        ringing: ringStatus,
      }),
    [connectionState, remoteHumanCount, ringStatus],
  );
  // Only calls nobody else was ever invited to (link / instant calls) get the invite card.
  const showWaitingCard =
    remoteHumanCount === 0 &&
    presence.isKnownToZero &&
    !presence.hasOtherInvitees &&
    connectionState === 'connected' &&
    !stageSummary.hasRemoteHuman;

  const handleToggleMic = useCallback(() => {
    logCallAction('mic_pressed', {
      callId,
      source: 'call_screen',
      enable: !isMicrophoneEnabled,
    });
    toggleMic();
  }, [callId, isMicrophoneEnabled, toggleMic]);

  const handleToggleCamera = useCallback(() => {
    logCallAction('camera_pressed', { callId, source: 'call_screen', enable: !isCameraEnabled });
    toggleCamera();
  }, [callId, isCameraEnabled, toggleCamera]);

  const handleToggleScreenShare = useCallback(() => {
    logCallAction('screen_share_pressed', {
      callId,
      source: 'call_screen',
      enable: !isScreenShareEnabled,
    });
    if (Platform.OS === 'ios' && !isScreenShareEnabled) {
      // iOS ReplayKit broadcast flow:
      // 1. Call setScreenShareEnabled(true) first — this starts LiveKit's socket server
      //    that the broadcast extension connects to.
      // 2. Wait long enough for the socket to be listening before showing the picker.
      //    100 ms was too short on slower devices; 500 ms is safe in practice.
      // 3. Show the RPSystemBroadcastPickerView so the user selects "Start Broadcast".
      toggleScreenShare();
      const reactTag = findNodeHandle(screenCaptureRef.current);
      if (reactTag) {
        const pickerManager = (
          NativeModules as Record<string, { show(tag: number): Promise<void> } | undefined>
        )['ScreenCapturePickerViewManager'];
        setTimeout(() => {
          logCallAction('screen_share_picker_shown', {
            callId,
            hasPicker: !!pickerManager,
          });
          void pickerManager?.show(reactTag);
        }, 500);
      } else {
        logCallAction('screen_share_picker_shown', { callId, outcome: 'no_react_tag' }, 'warn');
      }
    } else {
      toggleScreenShare();
    }
  }, [callId, toggleScreenShare, isScreenShareEnabled]);

  const handleToggleAI = useCallback(() => {
    logCallAction('ai_assistant_pressed', {
      callId,
      source: 'more_sheet',
      enable: !isAIAssistantEnabled,
    });
    toggleAIAssistant();
  }, [callId, isAIAssistantEnabled, toggleAIAssistant]);

  const handleApproveControlRequest = useCallback(() => {
    logCallAction('ai_control_request_approved', {
      callId,
      requesterId: pendingControlRequest?.requesterId,
    });
    approveControlRequest();
  }, [approveControlRequest, callId, pendingControlRequest?.requesterId]);

  const handleDenyControlRequest = useCallback(() => {
    logCallAction('ai_control_request_denied', {
      callId,
      requesterId: pendingControlRequest?.requesterId,
    });
    denyControlRequest();
  }, [callId, denyControlRequest, pendingControlRequest?.requesterId]);

  const handleRequestControl = useCallback(() => {
    logCallAction('ai_control_requested', { callId, source: 'more_sheet', hasRoom: !!room });
    if (!room) return;
    const localIdentity = room.localParticipant.identity;
    const localName = room.localParticipant.name || 'Unknown';
    void room.localParticipant.publishData(
      new TextEncoder().encode(
        JSON.stringify({
          type: AI_MESSAGE_TYPES.CONTROL_REQUEST,
          requester_id: localIdentity,
          requester_name: localName,
        }),
      ),
      { reliable: true, topic: AI_DATA_TOPIC },
    );
    roomActor.send({ type: 'AI_CONTROL_REQUEST_SENT' });
  }, [callId, room]);

  const shareableLink = callId ? `${PUBLIC_DEEP_LINK_ORIGIN}/call/${callId}` : undefined;

  const handleShareLink = useCallback(async () => {
    if (shareableLink) {
      try {
        const result = await Share.share({
          message: shareableLink,
          url: shareableLink,
          title: 'Join my call',
        });
        logCallAction('share_link', { callId, outcome: result.action });
      } catch (error) {
        // Share cancelled or failed
        logCallAction(
          'share_link',
          { callId, outcome: 'failed', error: errorMessage(error) },
          'warn',
        );
      }
    }
  }, [callId, shareableLink]);

  const handleFlipCamera = useCallback(() => {
    logCallAction('camera_flip_pressed', { callId, source: 'call_screen' });
    void callRuntimeNativeService.flipCamera();
  }, [callId]);

  const handleAudioPress = useCallback(async () => {
    logCallAction('audio_route_pressed', { callId, source: 'call_screen', from: audio.active });
    const result = await audio.quickToggle();
    logCallAction('audio_route_quick_toggle', { callId, outcome: result });
    if (result === 'needs-picker') setIsMoreOpen(true);
  }, [audio, callId]);

  // A host with others still on the call chooses between leaving and ending it for everyone.
  const handleDisconnectClick = useCallback(() => {
    const showsEndCallChoice = isHost && remoteHumanCount > 0;
    logCallAction('end_call_pressed', {
      callId,
      source: 'call_screen',
      isHost,
      remoteHumanCount,
      showsEndCallChoice,
    });
    if (showsEndCallChoice) {
      setIsEndCallDrawerOpen(true);
    } else {
      onDisconnect();
    }
  }, [callId, isHost, remoteHumanCount, onDisconnect]);

  const handleLeaveCall = useCallback(() => {
    logCallAction('leave_call', { callId, source: 'call_screen' });
    onDisconnect();
  }, [callId, onDisconnect]);

  const handleEndForEveryone = useCallback(async () => {
    logCallAction('end_call_for_everyone', { callId, source: 'call_screen' });
    try {
      await callService.endCallForAll(callId);
    } catch (error) {
      console.error('[NativeCallScreen] Failed to end call for all:', error);
      logCallAction(
        'end_call_for_everyone',
        { callId, outcome: 'failed', error: errorMessage(error) },
        'error',
      );
    }
    onDisconnect();
  }, [callId, onDisconnect]);

  const openParticipants = useCallback(() => setIsParticipantsOpen(true), []);
  const openInvite = useCallback(() => setIsInviteDrawerOpen(true), []);
  const closeMore = useCallback(() => setIsMoreOpen(false), []);
  const openMore = useCallback(() => setIsMoreOpen(true), []);

  // Show loading if room is not available yet
  if (!room) {
    return (
      <CallConnectingView
        title={presence.title}
        statusText='Connecting…'
        heroUserId={presence.heroUserId}
        topInset={insets.top}
        bottomInset={getControlBarOffset(insets.bottom) + callLayout.controlBarHeight}
        onBack={onBack}
      />
    );
  }

  return (
    <LiveKitRoomProvider room={room}>
      <CallScreenLayout
        chromeVisible={chrome.visible}
        onChromeTouch={chrome.poke}
        renderStage={stageInsets => (
          <CallStage
            insets={stageInsets}
            ringing={presence.ringing}
            localCameraOn={isCameraEnabled}
            aiController={aiController}
            onStageTap={chrome.toggle}
            onOverflowPress={openParticipants}
            onStopScreenShare={handleToggleScreenShare}
            onSummaryChange={setStageSummary}
          />
        )}
        renderBanner={topInset => (
          <CallConnectionBanner connectionState={connectionState} topInset={topInset} />
        )}
        renderOverlay={stageInsets =>
          showWaitingCard ? (
            <WaitingForOthers
              bottomOffset={stageInsets.bottom + 12}
              onShareLink={shareableLink ? handleShareLink : undefined}
              onAddPeople={openInvite}
            />
          ) : null
        }
        header={{
          title: presence.title,
          status,
          timerStartMs: talkStartMs,
          participantCount: visibleParticipants.length,
          onBack,
          onOpenParticipants: openParticipants,
          onAddParticipant: openInvite,
          onFlipCamera: isCameraEnabled ? handleFlipCamera : undefined,
        }}
        controls={{
          isMicEnabled: isMicrophoneEnabled,
          isCameraEnabled,
          isScreenShareEnabled,
          audioRoute: audio.active,
          onToggleMic: handleToggleMic,
          onToggleCamera: handleToggleCamera,
          onToggleScreenShare: handleToggleScreenShare,
          onAudioPress: handleAudioPress,
          onOpenMore: openMore,
          onDisconnect: handleDisconnectClick,
        }}
      >
        <CallMoreSheet
          isVisible={isMoreOpen}
          onClose={closeMore}
          isCameraEnabled={isCameraEnabled}
          participantCount={visibleParticipants.length}
          audio={audio}
          onAddPeople={openInvite}
          onOpenChat={onOpenChat}
          onShareLink={shareableLink ? handleShareLink : undefined}
          onOpenParticipants={openParticipants}
          onFlipCamera={handleFlipCamera}
          isAIAssistantEnabled={isAIAssistantEnabled}
          aiController={aiController}
          pendingControlRequest={pendingControlRequest}
          localParticipantId={localParticipantId || null}
          onToggleAI={handleToggleAI}
          onRequestControl={handleRequestControl}
        />

        <ParticipantsDrawer
          isVisible={isParticipantsOpen}
          onClose={() => setIsParticipantsOpen(false)}
          externalCallId={callId}
          isHost={isHost}
          livekitParticipants={visibleParticipants.map(p => ({
            identity: p.identity,
            name: p.name || p.identity,
            isCameraEnabled: p.isCameraEnabled,
            isMicrophoneEnabled: p.isMicrophoneEnabled,
          }))}
          localParticipantIdentity={localParticipantId ?? undefined}
          onAddPeople={openInvite}
        />

        <InviteUserDrawer
          isVisible={isInviteDrawerOpen}
          onClose={() => setIsInviteDrawerOpen(false)}
          callId={callId}
        />

        <EndCallDrawer
          isVisible={isEndCallDrawerOpen}
          onClose={() => setIsEndCallDrawerOpen(false)}
          onLeaveCall={handleLeaveCall}
          onEndForEveryone={handleEndForEveryone}
          isHost={isHost}
          participantCount={visibleParticipants.length}
        />

        {/* AI Control Request Drawer */}
        <AiControlRequestSheet
          isOpen={isControlRequestSheetOpen}
          requesterName={pendingControlRequest?.requesterName || 'Unknown User'}
          onApprove={handleApproveControlRequest}
          onDeny={handleDenyControlRequest}
        />

        {/* iOS: ScreenCapturePickerView */}
        {Platform.OS === 'ios' && (
          <View style={styles.hiddenPicker}>
            <ScreenCapturePickerView ref={screenCaptureRef} />
          </View>
        )}
      </CallScreenLayout>
    </LiveKitRoomProvider>
  );
};

const styles = StyleSheet.create({
  hiddenPicker: {
    width: 0,
    height: 0,
    overflow: 'hidden',
  },
});

export const NativeCallScreen: React.FC<NativeCallScreenProps> = ({
  channelId,
  callType = CallType.AUDIO,
  shouldInitiateCall = true,
  initialMicrophoneEnabled,
  initialCameraEnabled,
}) => {
  const router = useRouter();
  const navigation = useNavigation();
  const { user } = useAuth();
  const insets = useRawSafeAreaInsets();
  const hasAttemptedConnection = useRef(false);
  const hasEnteredCallSetup = useRef(false);
  const hasSilentlyDismissed = useRef(false);
  const wasConnected = useRef(false);
  const pendingRouteExitRef = useRef<(() => void) | null>(null);
  const [allowRouteRemoval, setAllowRouteRemoval] = useState(false);
  const [routeExitRequestId, setRouteExitRequestId] = useState(0);
  const [isLeavingCall, setIsLeavingCall] = useState(false);
  // The other side ended the call: show "Call ended" while the route pops instead of a loader.
  const [callEnded, setCallEnded] = useState(false);

  // Get state from roomMachine
  const {
    context: roomContext,
    participants,
    status,
    externalId,
    error,
    isConnected,
    isIdle,
    isInitiating,
    isJoining,
    isConnecting,
    isDisconnecting,
    isFailed,
    disconnect,
  } = useRoomMachine();

  // Who the call is with and who is still ringing (Zero roster) — shared by the connecting
  // screen and the live call.
  const presentIdentities = useMemo(
    () => new Set(participants.map(p => p.identity)),
    [participants],
  );
  const presenceCallId =
    externalId ?? roomContext.callId ?? (shouldInitiateCall ? null : channelId) ?? null;
  const presence = useCallPresence({
    externalId: presenceCallId,
    channelId: roomContext.channelId ?? (shouldInitiateCall ? channelId : null),
    targetUserIds: roomContext.targetUserIds,
    presentIdentities,
  });

  // Debug logging
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[XCALL][SCREEN] state changed', {
      status,
      externalId,
      channelId,
      error,
      isConnected,
      isInitiating,
      isConnecting,
      isDisconnecting,
      isFailed,
      isIdle,
      hasAttempted: hasAttemptedConnection.current,
      wasConnected: wasConnected.current,
    });
  }, [
    status,
    externalId,
    error,
    isConnected,
    isInitiating,
    isConnecting,
    isDisconnecting,
    isFailed,
    isIdle,
    channelId,
  ]);

  const [isHost, setIsHost] = useState(false);

  // Get active calls from Zero to determine host status
  const [activeCallsData, activeCallsDetails] = useQuery(queries.userActiveCalls());

  // Determine host status from Zero data
  const isHostFromZero = useMemo(() => {
    if (!externalId || activeCallsDetails.type !== 'complete' || !user?.user_id) return undefined;
    const callData = activeCallsData.find(c => c.externalId === externalId);
    return callData?.createdByUserId === user.user_id;
  }, [activeCallsData, activeCallsDetails.type, externalId, user?.user_id]);

  // Update isHost when Zero data changes
  useEffect(() => {
    if (activeCallsDetails.type === 'complete' && isHostFromZero !== undefined) {
      setIsHost(isHostFromZero);
    }
  }, [activeCallsDetails.type, isHostFromZero]);

  const safeNavigateBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(tabRoute('calls'));
    }
  }, [router]);

  // Track when we've been successfully connected
  useEffect(() => {
    if (isConnected) {
      wasConnected.current = true;
    }
  }, [isConnected]);

  useEffect(() => {
    if (isInitiating || isConnecting) {
      hasEnteredCallSetup.current = true;
    }
  }, [isInitiating, isConnecting]);

  // Auto-navigate back when call ends (machine returns to idle after having been connected)
  useEffect(() => {
    if (isIdle && wasConnected.current && !isLeavingCall) {
      wasConnected.current = false;
      setCallEnded(true);
      safeNavigateBack();
    }
  }, [isIdle, isLeavingCall, safeNavigateBack]);

  const returnToKeyguardIfNeeded = useCallback(async (): Promise<boolean> => {
    return CallNotificationDataModule.returnToKeyguardIfLockedAnsweredCall();
  }, []);

  const queueRouteExit = useCallback((navigate: () => void): void => {
    pendingRouteExitRef.current = navigate;
    setAllowRouteRemoval(true);
    setRouteExitRequestId(current => current + 1);
  }, []);

  usePreventRemove(!allowRouteRemoval, ({ data }) => {
    void (async (): Promise<void> => {
      const returnedToKeyguard = await returnToKeyguardIfNeeded();
      if (returnedToKeyguard) {
        queueRouteExit(() => router.replace(tabRoute('calls')));
        return;
      }

      queueRouteExit(() => {
        if (data.action.type === 'GO_BACK' && !navigation.canGoBack()) {
          router.replace(tabRoute('calls'));
          return;
        }
        navigation.dispatch(data.action);
      });
    })();
  });

  // Route removal is intentionally dispatched after allowRouteRemoval has
  // committed. This also lets cleanup finish after Android backgrounds the
  // task to reveal keyguard.
  useEffect(() => {
    if (!allowRouteRemoval || routeExitRequestId === 0) return;

    const pendingRouteExit = pendingRouteExitRef.current;
    pendingRouteExitRef.current = null;
    pendingRouteExit?.();
  }, [allowRouteRemoval, routeExitRequestId]);

  // Trigger call initiation/joining on mount
  useEffect(() => {
    if (hasAttemptedConnection.current) return;
    hasAttemptedConnection.current = true;

    if (shouldInitiateCall) {
      // Use roomMachine to initiate call
      roomActor.send({
        type: 'INITIATE_CALL',
        channelId,
        callType,
        zero: null, // Zero is managed separately in Lotus
        viewMode: 'full',
      });
      setIsHost(true);
    } else if (channelId) {
      // Use roomMachine to join call (only when we have a callId)
      roomActor.send({
        type: 'JOIN_CALL',
        callId: channelId,
        zero: null,
        viewMode: 'full',
        ...(initialMicrophoneEnabled !== undefined ? { initialMicrophoneEnabled } : {}),
        ...(initialCameraEnabled !== undefined ? { initialCameraEnabled } : {}),
      });
    }
    // else: call was already initiated externally (e.g. instant call from sheet) — just show machine state
  }, [channelId, callType, initialCameraEnabled, initialMicrophoneEnabled, shouldInitiateCall]);

  // Leaves the call screen with the call still running behind the top bar. `thenOpen` navigates
  // on from wherever that lands; it is skipped when the phone has to go back to the lock screen.
  const dismissCallScreen = useCallback(
    async (thenOpen?: () => void) => {
      const returnedToKeyguard = await returnToKeyguardIfNeeded();
      if (returnedToKeyguard) {
        queueRouteExit(() => router.replace(tabRoute('calls')));
        return;
      }

      queueRouteExit(() => {
        safeNavigateBack();
        thenOpen?.();
      });
    },
    [queueRouteExit, returnToKeyguardIfNeeded, router, safeNavigateBack],
  );

  // Dismiss immediately; room and CallKeep cleanup can finish off-screen.
  const handleDisconnect = useCallback(() => {
    setIsLeavingCall(true);
    disconnect();
    if (externalId) {
      callKitService.endCall(externalId);
    }
    clearAcceptedCallTracking(externalId ?? undefined);
    void dismissCallScreen();
  }, [disconnect, dismissCallScreen, externalId]);

  const handleBack = useCallback(() => {
    logCallAction('minimize', { callId: externalId ?? channelId, source: 'call_screen' });
    void dismissCallScreen();
  }, [channelId, dismissCallScreen, externalId]);

  // The call's own thread: the backend stamps the call message and its conversation onto
  // `calls.metadata` when the call starts (or a scheduled one activates). Scheduled calls
  // that post to a separate updates channel keep that thread there.
  const callThread = useMemo(() => {
    if (!presenceCallId) return null;
    const call = activeCallsData.find(c => c.externalId === presenceCallId);
    const metadata = call?.metadata as
      { conversationId?: unknown; systemMessageId?: unknown } | null | undefined;
    const threadId = typeof metadata?.conversationId === 'string' ? metadata.conversationId : null;
    if (!call || !threadId) return null;
    return {
      threadId,
      messageId: typeof metadata?.systemMessageId === 'string' ? metadata.systemMessageId : null,
      channelId: call.callUpdatesChannel ?? call.channelId ?? null,
    };
  }, [activeCallsData, presenceCallId]);
  const callThreadId = callThread?.threadId ?? null;
  const callThreadMessageId = callThread?.messageId ?? null;

  const chatChannelId = presence.chatChannelId;
  // Opens the call's thread; just the conversation until the call row has synced.
  const handleOpenChat = useCallback(() => {
    if (!chatChannelId) return;
    logCallAction('open_chat', {
      callId: externalId ?? channelId,
      source: 'more_sheet',
      chatChannelId,
      threadId: callThreadId,
    });
    void dismissCallScreen(() => {
      const intent = createChatOpenIntent(
        {
          channelId: (callThreadId && callThread?.channelId) || chatChannelId,
          ...(callThreadId ? { threadId: callThreadId } : {}),
          ...(callThreadId && callThreadMessageId ? { messageId: callThreadMessageId } : {}),
          openStartedAtMs: Date.now(),
        },
        'call',
      );
      if (intent) executeChatOpenIntent(router, intent);
    });
  }, [
    callThread?.channelId,
    callThreadId,
    callThreadMessageId,
    channelId,
    chatChannelId,
    dismissCallScreen,
    externalId,
    router,
  ]);

  const dismissFailedCall = useCallback(() => {
    if (hasSilentlyDismissed.current) return;
    hasSilentlyDismissed.current = true;
    clearAcceptedCallTracking((externalId ?? channelId) || undefined);

    void (async (): Promise<void> => {
      const returnedToKeyguard = await returnToKeyguardIfNeeded();
      if (returnedToKeyguard) {
        queueRouteExit(() => router.replace(tabRoute('calls')));
        return;
      }

      queueRouteExit(safeNavigateBack);
    })();
  }, [channelId, externalId, queueRouteExit, returnToKeyguardIfNeeded, router, safeNavigateBack]);

  // A failed call should leave no error/retry UI behind. Wait until the machine
  // has actually begun setup so the initial idle render cannot dismiss the screen.
  useEffect(() => {
    const missingCallId = !shouldInitiateCall && !channelId && !externalId;
    const stoppedBeforeConnecting = isIdle && hasEnteredCallSetup.current && !wasConnected.current;

    if (isFailed || missingCallId || stoppedBeforeConnecting) {
      dismissFailedCall();
    }
  }, [channelId, dismissFailedCall, externalId, isFailed, isIdle, shouldInitiateCall]);

  // Do not replace the call UI with a disconnecting loader while the route exits.
  if (isLeavingCall) {
    return null;
  }

  const connectingPhase = isInitiating ? 'initiating' : isJoining ? 'joining' : 'connecting';
  const connectingStatus = resolveCallStatus({
    phase: connectingPhase,
    connectionState: roomContext.connectionState,
    remoteHumanCount: 0,
    ringing: null,
  });

  return (
    <View style={callScreenStyles.root}>
      {/* The call surface is always dark, whatever the app theme. */}
      <StatusBar barStyle='light-content' />
      {isConnected && externalId ? (
        <NativeCallScreenContent
          callId={externalId}
          onDisconnect={handleDisconnect}
          onBack={handleBack}
          onOpenChat={chatChannelId ? handleOpenChat : undefined}
          isHost={isHost}
          presence={presence}
        />
      ) : (
        // Starting / joining / connecting — and the default while the machine settles.
        <CallConnectingView
          title={presence.title}
          statusText={callEnded ? 'Call ended' : connectingStatus.text}
          ended={callEnded}
          heroUserId={presence.heroUserId}
          topInset={insets.top}
          bottomInset={getControlBarOffset(insets.bottom) + callLayout.controlBarHeight}
          onBack={handleBack}
        />
      )}
    </View>
  );
};

const callScreenStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: callColors.stage,
  },
});
