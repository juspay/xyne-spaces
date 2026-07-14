import { useEffect, useCallback, useMemo, useState, useRef } from 'react';
import { useSelector } from '@xstate/react';
import type { Zero } from '@rocicorp/zero';
import { CallType, InvitationResponse } from '@xyne/shared';
import { toast } from 'sonner';
import { roomActor } from '../../../machines/roomMachine';
import { MiniCallView } from './MiniCallView';
import { FullCallView } from './FullCallView';
import { createCallReminderClock } from '../CallPrivacyIndicator/CallPrivacyReminder';
import type { CallReminderClock } from '../CallPrivacyIndicator/CallPrivacyReminder';
import { useHandRaise } from '../hooks/useHandRaise';
import { usePlatform } from '../../../hooks/usePlatform';
import { AIInviteDialog } from '../CallModals/AIInviteDialog';
import { CreateTicketModal } from '../../Tickets/CreateTicketModal/CreateTicketModal';
import { useChannel } from '../../../hooks/useChannels';
import { useAuth } from '../../../hooks/useAuth';
import { EndCallModal } from '../EndCallModal/EndCallModal';
import { AFKWarningModal } from '../AFKWarningModal/AFKWarningModal';
import {
  useIsCallHost,
  useIsOnlyParticipant,
  useCallParticipants,
  useIsLoneParticipant,
  findActiveCall,
  isCallRecording,
} from '../../../hooks/useCalls';
import { useAFKDetection } from '../hooks/useAFKDetection';
import { useUsers } from '../../../hooks/useUsers';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { useScreenPickerFlag } from '../../ScreenPicker/useScreenPickerFlag';
import { ScreenPickerModal } from '../../ScreenPicker/ScreenPickerModal';
import { mutators } from '../../../zero/mutators';
import { playAudio } from '../../../utils/audioPlayer';

import { isParticipantScreenShareEnabled } from '../../../utils/livekitScreenShare';
import { logger, Logger } from '../../../utils/logger';
import { CallWhiteboardSync } from '../CallWhiteboard';
import { callService } from '../../../services/Call/callService';
import {
  createCallWhiteboardPngBlobs,
  getCallWhiteboardState,
  isCallWhiteboardSaved,
  markCallWhiteboardSaved,
  sendCallWhiteboardEvent,
} from '../../../stores/callWhiteboardStore';

export interface CustomLiveKitRoomProps {
  token: string;
  serverUrl: string;
  callId: string;
  callType: CallType;
  externalId: string;
  zero: Zero | null;
}

export function CustomLiveKitRoom({
  token,
  serverUrl,
  callId,
  callType,
  externalId,
  zero,
}: CustomLiveKitRoomProps): React.ReactElement {
  // Sync custom screen picker on/off from CAC — only active while in a call
  useScreenPickerFlag();
  const isSavingWhiteboardRef = useRef(false);

  // Subscribe to room state from global XState machine using a single snapshot
  const snapshot = useSelector(roomActor, state => state);
  const { isMobile } = usePlatform();
  const { user } = useAuth();

  // Extract values from snapshot
  const {
    participants,
    connectionState,
    isAIAssistantEnabled,
    aiController,
    pendingControlRequest,
    isAiControlRequested,
    viewMode: machineViewMode,
    roomLink,
    channelId,
    isChatOpen,
    room,
    activeCalls,
    inviteDialogOpen,
    inviteUsers,
    inviteSuggestedMessage,
    ticketDialogOpen,
    ticketTitle,
    ticketDescription,
    ticketBoardId,
    isNativeMode,
    isCallChatOpen,
    unreadCallChatCount,
  } = snapshot.context;

  // Hand raise state, synced over the data channel. Lifted here (always mounted for
  // the call) so it persists and keeps receiving across mini/PIP <-> full view switches.
  const { raisedHands, toggleHandRaise } = useHandRaise(room);
  // Session-scoped reminder clock lives here (always mounted for the whole call)
  // so the transcription disclosure timers survive the mini <-> full view switch.
  // It is passed to FullCallView only; mini call view never needs it.
  const privacyReminderClockRef = useRef<CallReminderClock>(createCallReminderClock());
  useEffect(() => {
    privacyReminderClockRef.current = createCallReminderClock();
  }, [callId]);

  // Compute state from LiveKit instead of storing in context
  const localParticipant = isNativeMode
    ? participants.find(p => p.isLocal)
    : room?.localParticipant;

  const isMicEnabled = localParticipant
    ? isNativeMode
      ? (localParticipant as (typeof participants)[0]).isMicrophoneEnabled
      : (localParticipant as NonNullable<typeof room>['localParticipant']).isMicrophoneEnabled
    : false;

  const isCameraEnabled = localParticipant
    ? isNativeMode
      ? (localParticipant as (typeof participants)[0]).isCameraEnabled
      : (localParticipant as NonNullable<typeof room>['localParticipant']).isCameraEnabled
    : false;

  const isScreenSharing = localParticipant
    ? isNativeMode
      ? (localParticipant as (typeof participants)[0]).isScreenShareEnabled
      : isParticipantScreenShareEnabled(
          localParticipant as NonNullable<typeof room>['localParticipant'],
        )
    : false;

  // Determine simple machine state string for child components
  // Handle nested states like { connected: 'nativeMode' }
  const machineState = snapshot.matches('connected')
    ? 'connected'
    : snapshot.matches('connecting')
      ? 'connecting'
      : snapshot.matches('initiating')
        ? 'initiating'
        : snapshot.matches('joining')
          ? 'joining'
          : snapshot.matches('disconnecting')
            ? 'disconnecting'
            : 'idle';

  const activeCall = useMemo(
    () => findActiveCall(activeCalls, externalId),
    [activeCalls, externalId],
  );

  const metadata = useMemo(
    () => activeCall?.metadata as { conversationId?: string; channelId?: string } | undefined,
    [activeCall],
  );

  const callUpdatesChannelId = activeCall?.callUpdatesChannel ?? metadata?.channelId ?? channelId;

  const isRecording = useMemo(
    () => isCallRecording(activeCalls, externalId),
    [activeCalls, externalId],
  );

  const currentChannel = useChannel(channelId || '');

  useEffect(() => {
    sendCallWhiteboardEvent({ type: 'setCallId', callId });

    return (): void => {
      sendCallWhiteboardEvent({ type: 'setCallId', callId: null });
    };
  }, [callId]);

  // const isAiControlRequested = useMemo(() => {
  //   return pendingControlRequest !== null;
  // }, [pendingControlRequest]);
  // Connect to room on mount
  useEffect(() => {
    if (token && serverUrl) {
      roomActor.send({
        type: 'CONNECT',
        token,
        serverUrl,
        callType,
        externalId,
        zero,
      });
    }
  }, [token, serverUrl, callType, externalId, zero]);
  // Toggle microphone via XState
  const toggleMicrophone = useCallback(() => {
    roomActor.send({ type: 'TOGGLE_MIC' });
  }, []);

  // Toggle camera via XState
  const toggleCamera = useCallback(() => {
    roomActor.send({ type: 'TOGGLE_CAMERA' });
  }, []);

  // Toggle screen share via XState
  const toggleScreenShare = useCallback(() => {
    roomActor.send({ type: 'TOGGLE_SCREEN_SHARE' });
  }, []);

  const [showEndCallModal, setShowEndCallModal] = useState(false);

  const isHost = useIsCallHost(externalId, user?.id);

  const allUsers = useUsers();

  const callParticipants = useCallParticipants(externalId);

  const isOnlyParticipant = useIsOnlyParticipant(callParticipants);

  // AFK detection: true when user is the only participant
  const isLoneParticipant = useIsLoneParticipant(callParticipants);

  const internalCallId = useMemo(() => {
    const activeCall = findActiveCall(activeCalls, externalId);
    return (activeCall as { id?: string } | undefined)?.id;
  }, [activeCalls, externalId]);

  // Lobby requests from external AND internal users — only visible to the call host
  const lobbyRequests = useMemo(
    () => (isHost ? callParticipants.filter(p => p.response === InvitationResponse.REQUESTED) : []),
    [isHost, callParticipants],
  );

  // Toast notification when new lobby request arrives
  const prevLobbyCountRef = useRef(lobbyRequests.length);
  useEffect(() => {
    if (lobbyRequests.length > prevLobbyCountRef.current) {
      const newest = lobbyRequests[lobbyRequests.length - 1];
      if (newest) {
        // Resolve name: external → displayName, internal → look up from users
        let name: string | undefined;
        if (newest.isExternal) {
          name = (newest as { displayName?: string | null }).displayName ?? undefined;
        } else {
          const foundUser = allUsers.find(u => u.id === newest.userId);
          name = getUserDisplayName(foundUser);
        }
        toast.info(`${name ?? 'Someone'} is requesting to join`, {
          duration: 5000,
        });
        playAudio('/sounds/notification.wav');
      }
    }
    prevLobbyCountRef.current = lobbyRequests.length;
  }, [lobbyRequests, allUsers]);

  // Lobby approval handlers
  const handleApproveLobbyRequest = useCallback(
    (participantId: string) => {
      if (!zero || !internalCallId) return;
      void zero.mutate(
        mutators.calls.approveLobbyRequest({ callId: internalCallId, participantId }),
      );
    },
    [zero, internalCallId],
  );

  const handleRejectLobbyRequest = useCallback(
    (participantId: string) => {
      if (!zero || !internalCallId) return;
      void zero.mutate(
        mutators.calls.rejectLobbyRequest({ callId: internalCallId, participantId }),
      );
    },
    [zero, internalCallId],
  );

  const saveWhiteboardIfNeeded = useCallback(async (): Promise<void> => {
    const whiteboardState = getCallWhiteboardState();
    if (
      !whiteboardState.hasContent ||
      isCallWhiteboardSaved(callId) ||
      isSavingWhiteboardRef.current
    ) {
      return;
    }

    isSavingWhiteboardRef.current = true;
    try {
      const pngs = await createCallWhiteboardPngBlobs();
      if (pngs.length === 0) return;

      for (const png of pngs) {
        await callService.saveWhiteboard(callId, png);
      }
      markCallWhiteboardSaved(callId);
    } catch (error) {
      toast.error('Whiteboard could not be saved');
      logger.error(Logger.Event.FRONTEND_ERROR, {
        feature: 'call-whiteboard',
        reason: 'save-whiteboard-failed',
        callId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      isSavingWhiteboardRef.current = false;
    }
  }, [callId]);

  const handleDisconnect = useCallback(
    (endForAll = false) => {
      void (async (): Promise<void> => {
        const isOnlyConnectedParticipant = (room?.remoteParticipants.size ?? 0) === 0;
        if (endForAll || isOnlyParticipant || isOnlyConnectedParticipant) {
          await saveWhiteboardIfNeeded();
        }

        if (isChatOpen) {
          roomActor.send({ type: 'TOGGLE_CHAT' });
        }
        roomActor.send({ type: 'DISCONNECT', endForAll });
        setShowEndCallModal(false);
      })();
    },
    [isChatOpen, isOnlyParticipant, room?.remoteParticipants.size, saveWhiteboardIfNeeded],
  );

  const handleDisconnectClick = useCallback(() => {
    if (isHost && !isOnlyParticipant) {
      setShowEndCallModal(true);
    } else {
      handleDisconnect();
    }
  }, [isHost, isOnlyParticipant, handleDisconnect]);

  // End call for everyone (host only)
  const handleEndForAll = useCallback(() => {
    // handleDisconnect will close thread panel and send DISCONNECT with endForAll=true
    handleDisconnect(true);
  }, [handleDisconnect]);

  // AFK detection hook - shows warning modal when user is alone, auto-ends call if no response
  const {
    showAFKModal,
    secondsRemaining: afkSecondsRemaining,
    handleStay: handleAFKStay,
    handleLeave: handleAFKLeave,
  } = useAFKDetection({
    isLoneParticipant,
    onEndCall: handleEndForAll,
  });

  const handleToggleThread = useCallback(() => {
    if (callUpdatesChannelId && metadata?.conversationId) {
      roomActor.send({ type: 'TOGGLE_CHAT' });
    }
  }, [callUpdatesChannelId, metadata]);

  const handleToggleCallChat = useCallback(() => {
    roomActor.send({ type: 'TOGGLE_CALL_CHAT' });
  }, []);

  const handleCallChatNewMessage = useCallback(() => {
    if (!isCallChatOpen) {
      roomActor.send({ type: 'INCREMENT_UNREAD_CALL_CHAT' });
    }
  }, [isCallChatOpen]);

  // AI Invite dialog handlers
  const handleCloseInviteDialog = useCallback(() => {
    roomActor.send({ type: 'CLOSE_INVITE_DIALOG' });
  }, []);

  const handleSendInvite = useCallback((userIds: string[], message: string) => {
    roomActor.send({ type: 'SEND_INVITE', userIds, message });
  }, []);

  // AI Ticket dialog handlers
  const handleCloseTicketDialog = useCallback(() => {
    roomActor.send({ type: 'CLOSE_TICKET_DIALOG' });
  }, []);

  const handleTicketCreated = useCallback(() => {
    roomActor.send({ type: 'TICKET_CREATED' });
  }, []);

  // Prepare initial values for AI ticket creation
  const initialTicketAssignee = useMemo(() => {
    if (user?.id) {
      return { type: 'assigneeTo' as const, value: user.id };
    }
    return null;
  }, [user?.id]);

  const initialTicketEta = useMemo(() => {
    // Set due date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(23, 59, 59, 999); // End of tomorrow
    return tomorrow;
  }, []);

  // Handle request for AI control
  const handleRequestControl = useCallback(() => {
    if (room) {
      const localIdentity = room.localParticipant.identity;
      const localName = room.localParticipant.name || 'Unknown';
      void room.localParticipant.publishData(
        new TextEncoder().encode(
          JSON.stringify({
            type: 'ai_control_request',
            requester_id: localIdentity,
            requester_name: localName,
          }),
        ),
        { reliable: true },
      );
      // Send event to track that local user has a pending request
      roomActor.send({ type: 'AI_CONTROL_REQUEST_SENT' });
    }
  }, [room]);

  // Don't render if in native mode - native UI will handle the call
  if (isNativeMode) {
    return <></>;
  }

  // Route to appropriate view based on viewMode
  if (machineViewMode === 'mini') {
    // Mobile call UI is in AppRoot; keep whiteboard sync alive. Desktop shows mini view.
    if (isMobile) {
      return <CallWhiteboardSync room={room} />;
    }

    return (
      <>
        <CallWhiteboardSync room={room} />
        <MiniCallView
          participants={participants}
          isMicEnabled={isMicEnabled}
          isCameraEnabled={isCameraEnabled}
          isScreenSharing={isScreenSharing}
          isAIAssistantEnabled={isAIAssistantEnabled}
          aiController={aiController}
          requestedAiController={isAiControlRequested}
          localParticipantId={room?.localParticipant.identity ?? null}
          connectionState={connectionState}
          machineState={machineState}
          callId={callId}
          roomLink={roomLink || ''}
          isChatOpen={isChatOpen}
          channelId={callUpdatesChannelId}
          conversationId={metadata?.conversationId || null}
          room={room}
          pendingControlRequest={pendingControlRequest}
          onToggleMic={toggleMicrophone}
          onToggleCamera={toggleCamera}
          onToggleScreenShare={toggleScreenShare}
          onDisconnect={handleDisconnectClick}
          onExpand={() => roomActor.send({ type: 'TOGGLE_VIEW' })}
          onToggleThread={handleToggleThread}
          onRequestControl={handleRequestControl}
          callParticipants={callParticipants}
          isHost={isHost}
          currentUserId={user?.id ?? null}
          onApproveLobbyRequest={handleApproveLobbyRequest}
          onRejectLobbyRequest={handleRejectLobbyRequest}
          onCallChatNewMessage={handleCallChatNewMessage}
          raisedHands={raisedHands}
          onToggleHandRaise={toggleHandRaise}
        />
        <EndCallModal
          isOpen={showEndCallModal}
          onClose={() => setShowEndCallModal(false)}
          onEndForSelf={() => handleDisconnect()}
          onEndForAll={handleEndForAll}
          isHost={isHost}
        />
        <AFKWarningModal
          isOpen={showAFKModal}
          secondsRemaining={afkSecondsRemaining}
          onStay={handleAFKStay}
          onLeave={handleAFKLeave}
        />
        <AIInviteDialog
          isOpen={inviteDialogOpen}
          onClose={handleCloseInviteDialog}
          onSend={handleSendInvite}
          callId={callId}
          users={inviteUsers}
          suggestedMessage={inviteSuggestedMessage}
          roomLink={roomLink || undefined}
        />
        {channelId && currentChannel?.projectId && (
          <CreateTicketModal
            isOpen={ticketDialogOpen}
            onClose={handleCloseTicketDialog}
            channelId={channelId}
            projectId={currentChannel.projectId}
            selectedBoardId={ticketBoardId}
            initialTitle={ticketTitle}
            initialDescription={ticketDescription}
            initialAssignee={initialTicketAssignee}
            initialEta={initialTicketEta}
            isFromAI={true}
            onTicketCreated={handleTicketCreated}
          />
        )}
        <ScreenPickerModal />
      </>
    );
  }

  return (
    <>
      <CallWhiteboardSync room={room} />
      <FullCallView
        participants={participants}
        isMicEnabled={isMicEnabled}
        isCameraEnabled={isCameraEnabled}
        isScreenSharing={isScreenSharing}
        isAIAssistantEnabled={isAIAssistantEnabled}
        aiController={aiController}
        localParticipantId={room?.localParticipant.identity || null}
        callId={callId}
        connectionState={connectionState}
        machineState={machineState}
        roomLink={roomLink || ''}
        isChatOpen={isChatOpen}
        channelId={callUpdatesChannelId}
        conversationId={metadata?.conversationId || null}
        room={room}
        pendingControlRequest={pendingControlRequest}
        onToggleMic={toggleMicrophone}
        onToggleCamera={toggleCamera}
        onToggleScreenShare={toggleScreenShare}
        onDisconnect={handleDisconnectClick}
        onMinimize={() => roomActor.send({ type: 'TOGGLE_VIEW' })}
        reminderClockRef={privacyReminderClockRef}
        onToggleThread={handleToggleThread}
        onRequestControl={handleRequestControl}
        requestedAiController={isAiControlRequested}
        callParticipants={callParticipants}
        isHost={isHost}
        isRecording={isRecording}
        currentUserId={user?.id ?? null}
        onApproveLobbyRequest={handleApproveLobbyRequest}
        onRejectLobbyRequest={handleRejectLobbyRequest}
        isCallChatOpen={isCallChatOpen}
        onToggleCallChat={handleToggleCallChat}
        unreadCallChatCount={unreadCallChatCount}
        onCallChatNewMessage={handleCallChatNewMessage}
        raisedHands={raisedHands}
        onToggleHandRaise={toggleHandRaise}
      />
      <EndCallModal
        isOpen={showEndCallModal}
        onClose={() => setShowEndCallModal(false)}
        onEndForSelf={() => handleDisconnect()}
        onEndForAll={handleEndForAll}
        isHost={isHost}
      />
      <AFKWarningModal
        isOpen={showAFKModal}
        secondsRemaining={afkSecondsRemaining}
        onStay={handleAFKStay}
        onLeave={handleAFKLeave}
      />
      <AIInviteDialog
        isOpen={inviteDialogOpen}
        onClose={handleCloseInviteDialog}
        onSend={handleSendInvite}
        callId={callId}
        users={inviteUsers}
        suggestedMessage={inviteSuggestedMessage}
        roomLink={roomLink || undefined}
      />
      {channelId && currentChannel?.projectId && (
        <CreateTicketModal
          isOpen={ticketDialogOpen}
          onClose={handleCloseTicketDialog}
          channelId={channelId}
          projectId={currentChannel.projectId}
          selectedBoardId={ticketBoardId}
          initialTitle={ticketTitle}
          initialDescription={ticketDescription}
          initialAssignee={initialTicketAssignee}
          initialEta={initialTicketEta}
          isFromAI={true}
          onTicketCreated={handleTicketCreated}
        />
      )}
      <ScreenPickerModal />
    </>
  );
}
