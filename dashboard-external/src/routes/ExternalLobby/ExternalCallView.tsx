import { useEffect, useCallback, useRef, useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { useQuery } from '@tanstack/react-query';
import { ConnectionState } from 'livekit-client';
import { RoomAudioRenderer } from '@livekit/components-react';
import { CallType } from '@xyne/shared';
import { roomActor } from '@/machines/roomMachine';
import { FullCallView } from '@/components/Call/CallViews/FullCallView';
import { callLobbyService } from '@/services/Call/callLobbyService';

interface ExternalCallViewProps {
  token: string;
  serverUrl: string;
  callId: string;
  externalId: string;
  callType: CallType;
  participantId: string;
  /** Called when the external user disconnects (room goes idle) */
  onDisconnected: () => void;
}

/**
 * Stripped-down in-call view for external (unauthenticated) users.
 *
 * - No Zero / no ZeroProvider needed
 * - Chat is disabled
 * - Minimize is a no-op
 * - AI assistant is disabled
 * - Invite is hidden (no Zero)
 * - Participants fetched via API and mapped to sidebar format
 */
export function ExternalCallView({
  token,
  serverUrl,
  callId: _callId,
  externalId,
  callType,
  participantId,
  onDisconnected,
}: ExternalCallViewProps) {
  const wasConnectedRef = useRef(false);

  // Connect to LiveKit room via the global XState machine
  useEffect(() => {
    if (token && serverUrl) {
      roomActor.send({
        type: 'CONNECT',
        token,
        serverUrl,
        callType,
        externalId,
        zero: null,
      });
    }
    return () => {
      roomActor.send({ type: 'DISCONNECT', endForAll: false });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, serverUrl, callType, externalId]);

  // Subscribe to room state
  const snapshot = useSelector(roomActor, s => s);
  const { participants, connectionState, roomLink, room, isCallChatOpen, unreadCallChatCount } =
    snapshot.context;

  // Track connection state to detect disconnections
  const isConnected = snapshot.matches('connected');
  const isIdle = snapshot.matches('idle');

  useEffect(() => {
    if (isConnected) {
      wasConnectedRef.current = true;
    }
  }, [isConnected]);

  useEffect(() => {
    if (isIdle && wasConnectedRef.current) {
      wasConnectedRef.current = false;
      onDisconnected();
    }
  }, [isIdle, onDisconnected]);

  // Poll participants from the API so external users can see who's in the call
  const participantsQuery = useQuery({
    queryKey: ['call-lobby-participants', externalId],
    queryFn: () => callLobbyService.getParticipants(externalId),
    enabled: isConnected,
    refetchInterval: 5000,
    staleTime: 0,
  });

  // Map API participants to the CallParticipant format expected by ParticipantsSidebar
  const callParticipants = useMemo(() => {
    if (!participantsQuery.data) return [];
    return participantsQuery.data.map(p => ({
      id: p.id,
      callId: externalId,
      userId: p.userId,
      invitedBy: '',
      invitedAt: 0,
      response: p.response,
      respondedAt: null,
      joinedAt: null,
      leftAt: null,
      metadata: null,
      displayName: p.displayName,
      isExternal: p.isExternal,
    }));
  }, [participantsQuery.data, externalId]);

  // Derive local participant from the LiveKit room object
  const localParticipant = room?.localParticipant;
  const isMicEnabled = localParticipant?.isMicrophoneEnabled ?? false;
  const isCameraEnabled = localParticipant?.isCameraEnabled ?? false;
  const isScreenSharing = localParticipant?.isScreenShareEnabled ?? false;

  const machineState = isConnected
    ? 'connected'
    : snapshot.matches('connecting')
      ? 'connecting'
      : snapshot.matches('disconnecting')
        ? 'disconnecting'
        : 'idle';

  const toggleMic = useCallback(() => roomActor.send({ type: 'TOGGLE_MIC' }), []);
  const toggleCamera = useCallback(() => roomActor.send({ type: 'TOGGLE_CAMERA' }), []);
  const toggleScreenShare = useCallback(() => roomActor.send({ type: 'TOGGLE_SCREEN_SHARE' }), []);
  const handleDisconnect = useCallback(
    () => roomActor.send({ type: 'DISCONNECT', endForAll: false }),
    [],
  );

  const handleToggleCallChat = useCallback(() => {
    roomActor.send({ type: 'TOGGLE_CALL_CHAT' });
  }, []);

  const handleCallChatNewMessage = useCallback(() => {
    if (!isCallChatOpen) {
      roomActor.send({ type: 'INCREMENT_UNREAD_CALL_CHAT' });
    }
  }, [isCallChatOpen]);

  return (
    <>
      {room && <RoomAudioRenderer room={room} />}
      <FullCallView
        participants={participants}
        isMicEnabled={isMicEnabled}
        isCameraEnabled={isCameraEnabled}
        isScreenSharing={isScreenSharing}
        isAIAssistantEnabled={false}
        aiController={null}
        requestedAiController={false}
        localParticipantId={participantId}
        callId={externalId}
        connectionState={connectionState ?? ConnectionState.Disconnected}
        machineState={machineState}
        roomLink={roomLink ?? ''}
        channelId={null}
        conversationId={null}
        isChatOpen={false}
        room={room ?? null}
        pendingControlRequest={null}
        onToggleMic={toggleMic}
        onToggleCamera={toggleCamera}
        onToggleScreenShare={toggleScreenShare}
        onDisconnect={handleDisconnect}
        onMinimize={() => {}}
        onToggleThread={() => {}}
        callParticipants={callParticipants}
        isHost={false}
        currentUserId={null}
        hideInvite={true}
        hideThreadChat={true}
        hideAIAssistant={true}
        hideMinimize={true}
        isExternalUser={true}
        isCallChatOpen={isCallChatOpen}
        onToggleCallChat={handleToggleCallChat}
        unreadCallChatCount={unreadCallChatCount}
        onCallChatNewMessage={handleCallChatNewMessage}
      />
    </>
  );
}
