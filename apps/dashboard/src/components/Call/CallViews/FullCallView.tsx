import type { Room } from 'livekit-client';
import { ConnectionQuality, ConnectionState } from 'livekit-client';
import { WifiLow } from 'lucide-react';
import { useSelector } from '@xstate/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useParticipantNetworkQuality,
  useNetworkQualityToast,
} from '../hooks/useParticipantNetworkQuality';
import { type RecordingType } from '@xyne/shared';
import type { ParticipantInfo } from '../../../machines/roomMachine';
import { roomActor } from '../../../machines/roomMachine';
import { cn } from '../../../utils/classNames';
import ThreadMessages from '../../Chat/ThreadPannel';
import { CallControls } from '../CallControls/CallControls';
import { CallStateTransition } from '../CallStateTransition/CallStateTransition';
import { ParticipantGrid } from '../ParticipantGrid/ParticipantGrid';
import { findPresentationParticipant } from '../ParticipantGrid/sortParticipants';
import { ScreenShareView } from '../ScreenShareView/ScreenShareView';
import { ControlRequestDialog } from '../CallModals/ControlRequestDialog';
import { ParticipantsSidebar } from '../ParticipantsSidebar/ParticipantsSidebar';
import { HostControlsPanel } from '../HostControlsPanel/HostControlsPanel';
import { ConnectionStatusIndicators } from '../ConnectionStatusIndicators/ConnectionStatusIndicators';
import { sendDrawEvent } from '../../../hooks/useDrawStore';
import { useCallWhiteboardStore } from '../../../stores/callWhiteboardStore';
import { useReactions } from '../hooks/useReactions';
import { ReactionsOverlay } from '../components/ReactionsOverlay';
import { CallChatPanel } from '../CallChatPanel/CallChatPanel';
import { useCallChatNotifications } from '../hooks/useCallChatNotifications';
import { recordingService } from '../../../services/Recording/recordingService';
import { useActiveRecording, type ActiveRecording } from '../hooks/useActiveRecording';
import { RecordingStopDialog } from '../CallControls/RecordingStopDialog';
import { CallPrivacyIndicator } from '../CallPrivacyIndicator/CallPrivacyIndicator';
import { isScreenShareActive } from '../../../utils/livekitScreenShare';
import { hasJoinedExternalParticipant } from '../callParticipant.utils';
import { CallWhiteboardView } from '../CallWhiteboard';
import { useAuth } from '../../../hooks/useAuth';
import { useTelepresenceEnabled } from '../useTelepresenceEnabled';
import { useAutoPresentationMode } from '../useAutoPresentationMode';
import { PresentationModeOverlay } from '../PresentationMode/PresentationModeOverlay';
import { formatElapsedTime } from '../../../utils/recordingUtils';
import { logger, Event } from '../../../utils/logger';
import { usePlatform } from '../../../hooks/usePlatform';

interface FullCallViewProps {
  participants: ParticipantInfo[];
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  isScreenSharing: boolean;
  isAIAssistantEnabled: boolean;
  aiController: { id: string; name: string } | null;
  requestedAiController: boolean;
  localParticipantId: string | null;
  callId: string;
  connectionState: ConnectionState;
  machineState: string;
  roomLink: string;
  channelId: string | null;
  conversationId: string | null;
  isChatOpen: boolean;
  room: Room | null;
  pendingControlRequest: { requesterId: string; requesterName: string } | null;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onDisconnect: () => void;
  onMinimize: () => void;
  onToggleThread: () => void;
  onRequestControl?: () => void;
  /** Optional: pass call participants data to sidebar (avoids Zero dependency) */
  callParticipants?:
    | ReadonlyArray<{
        readonly id: string;
        readonly callId: string;
        readonly userId: string;
        readonly invitedBy: string;
        readonly invitedAt: number;
        readonly response: string | null;
        readonly respondedAt: number | null;
        readonly joinedAt: number | null;
        readonly leftAt: number | null;
        readonly metadata: unknown;
        readonly displayName?: string | null | undefined;
        readonly isExternal?: boolean | undefined;
      }>
    | undefined;
  /** Optional: override host detection */
  isHost?: boolean | undefined;
  /** Optional: override current user ID */
  currentUserId?: string | null | undefined;
  /** Optional: callback when host admits a lobby participant */
  onApproveLobbyRequest?: ((participantId: string) => void) | undefined;
  /** Optional: callback when host declines a lobby participant */
  onRejectLobbyRequest?: ((participantId: string) => void) | undefined;
  /** Optional: hide invite button in sidebar */
  hideInvite?: boolean | undefined;
  /** Hide thread panel chat button (for external users) */
  hideThreadChat?: boolean | undefined;
  /** Hide AI assistant button (for external users) */
  hideAIAssistant?: boolean | undefined;
  /** Hide minimize button (for external users) */
  hideMinimize?: boolean | undefined;
  /** Whether the current user is an external (unauthenticated) user */
  isExternalUser?: boolean | undefined;
  /** Call chat panel state */
  isCallChatOpen?: boolean | undefined;
  onToggleCallChat?: (() => void) | undefined;
  unreadCallChatCount?: number | undefined;
  /** Called when a new remote call chat message arrives (for unread tracking) */
  onCallChatNewMessage?: (() => void) | undefined;
  /** Identities of participants with hand raised (synced via data channel) */
  raisedHands?: string[] | undefined;
  /** Toggle the local participant's raised hand */
  onToggleHandRaise?: (() => void) | undefined;
  /** Whether screen recording is currently active (synced from Zero) */
  isRecording?: boolean | undefined;
  /** Authoritative active recording state from the external lobby API. */
  externalActiveRecording?: ActiveRecording | null | undefined;
}

export function FullCallView({
  participants,
  isMicEnabled,
  isCameraEnabled,
  isScreenSharing,
  isAIAssistantEnabled,
  aiController,
  localParticipantId,
  callId,
  connectionState,
  machineState,
  roomLink,
  channelId,
  isChatOpen,
  conversationId,
  pendingControlRequest,
  room,
  onToggleMic,
  onToggleCamera,
  onToggleScreenShare,
  onDisconnect,
  onMinimize,
  onToggleThread,
  onRequestControl,
  requestedAiController,
  callParticipants,
  isHost: isHostProp,
  currentUserId,
  onApproveLobbyRequest,
  onRejectLobbyRequest,
  hideInvite,
  hideThreadChat = false,
  hideAIAssistant = false,
  hideMinimize = false,
  isExternalUser = false,
  isCallChatOpen = false,
  onToggleCallChat,
  unreadCallChatCount = 0,
  onCallChatNewMessage,
  raisedHands = [],
  onToggleHandRaise,
  isRecording: isRecordingProp = false,
  externalActiveRecording,
}: FullCallViewProps): React.ReactElement {
  // ALL HOOKS MUST BE DECLARED BEFORE ANY CONDITIONAL RETURNS
  const { user } = useAuth();
  const { isElectron, isMac } = usePlatform();
  const isTelepresenceEnabled = useTelepresenceEnabled(user?.email);

  // UI state
  const [focusedScreenShareIdentity, setFocusedScreenShareIdentity] = useState<string | null>(null);
  const [isParticipantsSidebarOpen, setIsParticipantsSidebarOpen] = useState(false);
  const [isHostControlsOpen, setIsHostControlsOpen] = useState(false);
  const isWhiteboardOpen = useCallWhiteboardStore(s => s.isOpen);
  const [isPresentationMode, setIsPresentationMode] = useState(false);
  useAutoPresentationMode(isTelepresenceEnabled, setIsPresentationMode);
  // Track local participant's network quality
  const networkQuality = useParticipantNetworkQuality(room?.localParticipant ?? null);
  const showQualityToast = useNetworkQualityToast(networkQuality);

  const isHost = isHostProp ?? false;

  // Host transcription kill-switch state (see roomMachine TOGGLE_TRANSCRIPTION).
  const isTranscriptionEnabled = useSelector(
    roomActor,
    state => state.context.isTranscriptionEnabled,
  );

  // Host display name (from room-metadata `createdBy`) for the non-host "who can
  // remove the agent" note in the transcription popover.
  const hostName = useMemo(() => {
    if (!room?.metadata) return null;
    try {
      const createdBy = (JSON.parse(room.metadata) as { createdBy?: string }).createdBy;
      if (!createdBy) return null;
      return participants.find(p => p.identity === createdBy)?.name ?? null;
    } catch {
      return null;
    }
  }, [room?.metadata, participants]);

  // Active-recording state is driven by room metadata so every participant (incl.
  // late joiners) sees the indicator. `isRecordingProp`/optimistic local state are
  // only fallbacks for the brief window before metadata propagates.
  const activeRecording = useActiveRecording(room);
  const [optimisticRecording, setOptimisticRecording] = useState(false);
  const displayActiveRecording =
    externalActiveRecording !== undefined ? externalActiveRecording : activeRecording;
  const isRecordingActive = !!displayActiveRecording || optimisticRecording || isRecordingProp;

  // Only the participant who started the recording may stop it (mirrors the
  // backend starter-only authz). When we started it optimistically and metadata
  // hasn't propagated yet, treat ourselves as the starter.
  const canStopRecording = activeRecording
    ? activeRecording.startedBy === currentUserId
    : optimisticRecording;

  // Reconcile optimistic flag once authoritative metadata arrives.
  useEffect(() => {
    setOptimisticRecording(!!activeRecording);
  }, [activeRecording]);

  // Elapsed recording timer (MM:SS, then HH:MM:SS after an hour) from the recording's start time.
  const recordingStartedAt = displayActiveRecording?.startedAt ?? null;
  const [recordingElapsed, setRecordingElapsed] = useState('00:00');
  useEffect(() => {
    if (!recordingStartedAt) {
      setRecordingElapsed('00:00');
      return;
    }
    const tick = (): void => {
      setRecordingElapsed(formatElapsedTime(Math.max(0, Date.now() - recordingStartedAt)));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [recordingStartedAt]);

  // Rename-on-stop popup state. When set, the dialog is shown.
  const [stopDialog, setStopDialog] = useState<{
    recordingId?: string;
    defaultName: string;
  } | null>(null);
  const [optimisticRecordingType, setOptimisticRecordingType] = useState<RecordingType | null>(
    null,
  );

  const handleStartRecording = useCallback(
    async (type: RecordingType): Promise<void> => {
      setOptimisticRecordingType(type);
      setOptimisticRecording(true);
      try {
        const res = await recordingService.startCallRecording(callId, type);
        if (res.alreadyActive) {
          // Someone else already started one — metadata reflects the real state.
          setOptimisticRecording(false);
          setOptimisticRecordingType(null);
        }
      } catch (err) {
        logger.error(Event.API_CALL_FAILED, {
          callId,
          context: 'FullCallView.startRecording',
          recordingType: type,
          error: err instanceof Error ? err.message : String(err),
        });
        setOptimisticRecording(false);
        setOptimisticRecordingType(null);
      }
    },
    [callId],
  );

  // Opening the rename popup; the actual stop happens on confirm/skip.
  // Non-starters never reach here (the button is disabled for them), but guard anyway.
  const handleStopRecording = useCallback((): void => {
    if (!canStopRecording) return;
    setStopDialog(
      activeRecording?.recordingId
        ? { recordingId: activeRecording.recordingId, defaultName: 'Recording' }
        : { defaultName: 'Recording' },
    );
  }, [canStopRecording, activeRecording]);

  const finalizeStopRecording = useCallback(
    async (name?: string): Promise<void> => {
      const recordingId = stopDialog?.recordingId;
      setStopDialog(null);
      setOptimisticRecording(false);
      setOptimisticRecordingType(null);
      try {
        await recordingService.stopCallRecording(callId, {
          ...(recordingId ? { recordingId } : {}),
          ...(name ? { name } : {}),
        });
      } catch (err) {
        logger.error(Event.API_CALL_FAILED, {
          callId,
          context: 'FullCallView.stopRecording',
          recordingId: recordingId ?? null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [callId, stopDialog],
  );

  // Reactions
  const { reactions, sendReaction } = useReactions(room);
  const displayRecordingType =
    displayActiveRecording?.recordingType ?? (optimisticRecording ? optimisticRecordingType : null);

  // Get call title and origin from activeCalls

  // Get all participants sharing screen
  // In native mode, use isScreenShareEnabled flag; in web mode, check the actual track publication
  const screenSharingParticipants = participants.filter(p => {
    // If no participant object (native mode), use the isScreenShareEnabled flag
    if (!p.participant) {
      return p.isScreenShareEnabled;
    }
    // Web mode: check actual track publication
    return isScreenShareActive(p.participant);
  });

  // Memoize screen sharer identities for dependency
  const screenSharerIdentities = screenSharingParticipants.map(p => p.identity).join(',');

  // Auto-focus first screen share if none is focused
  useEffect(() => {
    if (screenSharingParticipants.length > 0 && !focusedScreenShareIdentity) {
      setFocusedScreenShareIdentity(screenSharingParticipants[0]!.identity);
    } else if (screenSharingParticipants.length === 0 && focusedScreenShareIdentity) {
      setFocusedScreenShareIdentity(null);
    } else if (
      focusedScreenShareIdentity &&
      !screenSharingParticipants.some(p => p.identity === focusedScreenShareIdentity)
    ) {
      // Focused participant stopped sharing, switch to first available
      setFocusedScreenShareIdentity(screenSharingParticipants[0]?.identity || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenSharerIdentities, focusedScreenShareIdentity]);

  // Get the focused screen share participant
  const focusedScreenShare = screenSharingParticipants.find(
    p => p.identity === focusedScreenShareIdentity,
  );

  // Auto-disable drawing mode when screen share ends (no one sharing anymore)
  useEffect(() => {
    if (!focusedScreenShare) {
      sendDrawEvent({ type: 'disableDrawMode' });
    }
  }, [focusedScreenShare]);

  // Handle clicking on a screen share to focus it
  const handleScreenShareClick = useCallback((identity: string): void => {
    setFocusedScreenShareIdentity(identity);
  }, []);

  // Handle toggling participants sidebar (closes chat if open)
  const handleToggleParticipantsSidebar = useCallback((): void => {
    setIsParticipantsSidebarOpen(prev => {
      // If opening participants sidebar, close chat and call chat
      if (!prev && isChatOpen) {
        onToggleThread();
      }
      if (!prev && isCallChatOpen && onToggleCallChat) {
        onToggleCallChat();
      }
      if (!prev) {
        setIsHostControlsOpen(false);
      }
      return !prev;
    });
  }, [isChatOpen, onToggleThread, isCallChatOpen, onToggleCallChat]);

  const handleToggleHostControls = useCallback((): void => {
    setIsHostControlsOpen(prev => {
      if (!prev && isChatOpen) {
        onToggleThread();
      }
      if (!prev && isCallChatOpen && onToggleCallChat) {
        onToggleCallChat();
      }
      if (!prev) {
        setIsParticipantsSidebarOpen(false);
      }
      return !prev;
    });
  }, [isChatOpen, onToggleThread, isCallChatOpen, onToggleCallChat]);

  // Close participants sidebar when chat opens
  useEffect(() => {
    if (isChatOpen && isParticipantsSidebarOpen) {
      setIsParticipantsSidebarOpen(false);
    }
    if (isChatOpen && isHostControlsOpen) {
      setIsHostControlsOpen(false);
    }
  }, [isChatOpen, isParticipantsSidebarOpen, isHostControlsOpen]);

  // Show toast for incoming call chat messages
  useCallChatNotifications(room, localParticipantId, onCallChatNewMessage);

  const hasExternalJoined = useMemo(() => {
    return hasJoinedExternalParticipant(callParticipants);
  }, [callParticipants]);

  const canUseCallChat = isExternalUser || hasExternalJoined;
  const isCallChatVisible = canUseCallChat && isCallChatOpen;

  useEffect(() => {
    if (isCallChatOpen && !canUseCallChat && onToggleCallChat) {
      onToggleCallChat();
    }
  }, [canUseCallChat, isCallChatOpen, onToggleCallChat]);

  const presentationParticipant = useMemo(
    () => findPresentationParticipant(participants, localParticipantId),
    [participants, localParticipantId],
  );

  // Determine if any right sidebar is open (for layout adjustments)
  const isRightSidebarOpen = isChatOpen || isParticipantsSidebarOpen || isHostControlsOpen;

  return (
    <div
      className={cn(
        'h-screen bg-gradient-to-br from-gray-900 to-gray-950 flex flex-col overflow-hidden transition-all duration-300',
      )}
      data-testid='call-window'
    >
      {/* Floating reactions overlay */}
      <ReactionsOverlay reactions={reactions} />

      {/* Network quality toast — floats top-center, auto-dismisses after 5s */}
      {showQualityToast && (
        <div
          className={cn(
            'fixed top-4 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2 px-3 py-2 rounded-full text-xs font-semibold text-white shadow-lg pointer-events-none animate-in slide-in-from-top-2 duration-300',
            networkQuality === ConnectionQuality.Lost ? 'bg-red-600' : 'bg-amber-500',
          )}
          role='alert'
          aria-live='polite'
        >
          <WifiLow className='h-3.5 w-3.5 shrink-0' />
          {networkQuality === ConnectionQuality.Lost
            ? 'Connection lost — trying to reconnect…'
            : 'Your connection is unstable'}
        </div>
      )}

      {/* Connection Status Indicators Bar */}
      <div
        className={cn(
          'flex justify-between items-center pr-4 py-3',
          isElectron && isMac ? 'pl-24' : 'pl-4',
        )}
      >
        <div className='flex items-center gap-2'>
          <div className='relative visual-regression-hide'>
            <div className='w-2 h-2 bg-green-500 rounded-full'></div>
            <div className='absolute inset-0 w-2 h-2 bg-green-500 rounded-full animate-ping'></div>
          </div>
          <span className='text-white text-xs font-semibold'>Call Active</span>
          <span className='text-muted-foreground text-xs'>·</span>
          <span className='text-muted-foreground text-xs' data-testid='participant-count'>
            {participants.length} participant{participants.length !== 1 ? 's' : ''}
          </span>
          {isRecordingActive && (
            <>
              <span className='text-muted-foreground text-xs'>·</span>
              <span
                className='flex items-center gap-1 text-red-400 text-xs font-semibold'
                title={
                  displayActiveRecording?.startedByName
                    ? `Recording started by ${displayActiveRecording.startedByName}`
                    : 'This call is being recorded'
                }
              >
                <span className='w-2 h-2 bg-red-500 rounded-full animate-pulse inline-block' />
                REC {recordingElapsed}
              </span>
            </>
          )}
        </div>
        <div className='flex items-center gap-3'>
          <CallPrivacyIndicator
            isTranscriptionEnabled={isTranscriptionEnabled}
            isHost={isHost}
            hostName={hostName}
            onToggleTranscription={() => roomActor.send({ type: 'TOGGLE_TRANSCRIPTION' })}
            trackMetadata={{
              isRecordingActive,
              recordingType: displayRecordingType,
            }}
          />
          <ConnectionStatusIndicators room={room} />
        </div>
      </div>

      <CallStateTransition connectionState={connectionState} machineState={machineState}>
        {isWhiteboardOpen ? (
          <div
            className='flex-1 w-full pb-32 sm:pb-36 transition-all duration-300 overflow-hidden'
            style={{
              paddingRight: isRightSidebarOpen ? 'min(500px, 100vw)' : '0',
              paddingLeft: isCallChatVisible ? 'min(400px, 100vw)' : '0',
            }}
          >
            <CallWhiteboardView
              participants={participants}
              room={room}
              className='h-full'
              showSidebar={true}
              aiController={aiController}
              requestedAiController={requestedAiController}
            />
          </div>
        ) : focusedScreenShare ? (
          // Screen share layout with sidebar
          <div
            className='flex-1 w-full pb-32 sm:pb-36 transition-all duration-300 overflow-hidden'
            style={{
              paddingRight: isRightSidebarOpen ? 'min(500px, 100vw)' : '0',
              paddingLeft: isCallChatVisible ? 'min(400px, 100vw)' : '0',
            }}
          >
            <ScreenShareView
              focusedScreenShare={focusedScreenShare}
              participants={participants}
              onScreenShareClick={handleScreenShareClick}
              className='h-full'
              showSidebar={true}
              showDrawingTools={true}
              aiController={aiController}
              requestedAiController={requestedAiController}
              raisedHands={raisedHands}
              onToggleHandRaise={onToggleHandRaise}
            />
          </div>
        ) : (
          // Normal grid layout when no screen share
          <div
            className='flex-1 w-full pb-32 sm:pb-36 transition-all duration-300 overflow-hidden'
            style={{
              paddingRight: isRightSidebarOpen ? 'min(500px, 100vw)' : '0',
              paddingLeft: isCallChatVisible ? 'min(400px, 100vw)' : '0',
            }}
          >
            <ParticipantGrid
              participants={participants}
              aiController={aiController}
              requestedAiController={requestedAiController}
              raisedHands={raisedHands}
              onToggleHandRaise={onToggleHandRaise}
            />
          </div>
        )}

        {/* Control Bar */}
        <div
          className='absolute bottom-3 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-1rem)] sm:w-auto max-w-[calc(100%-1rem)] transition-transform duration-300'
          style={{
            transform: isRightSidebarOpen
              ? `translateX(calc(-50% - min(250px, 50vw)${isCallChatVisible ? ' + min(200px, 50vw)' : ''}))`
              : isCallChatVisible
                ? 'translateX(calc(-50% + min(200px, 50vw)))'
                : 'translateX(-50%)',
          }}
        >
          <CallControls
            isMicEnabled={isMicEnabled}
            isCameraEnabled={isCameraEnabled}
            isScreenSharing={isScreenSharing}
            isAnySharingScreen={!!focusedScreenShare}
            isChatOpen={isChatOpen}
            isParticipantsSidebarOpen={isParticipantsSidebarOpen}
            isHostControlsOpen={isHostControlsOpen}
            onToggleHostControls={handleToggleHostControls}
            isAIAssistantEnabled={isAIAssistantEnabled}
            aiController={aiController}
            localParticipantId={localParticipantId}
            callId={callId}
            roomLink={roomLink}
            onToggleMic={onToggleMic}
            onToggleCamera={onToggleCamera}
            onToggleScreenShare={onToggleScreenShare}
            onDisconnect={onDisconnect}
            onToggleView={onMinimize}
            onToggleChat={onToggleThread}
            onToggleParticipantsSidebar={handleToggleParticipantsSidebar}
            onToggleAIAssistant={() => roomActor.send({ type: 'TOGGLE_AI_ASSISTANT' })}
            onSendReaction={sendReaction}
            onRequestControl={onRequestControl}
            viewMode='full'
            requestedAiController={requestedAiController}
            pendingControlRequest={pendingControlRequest}
            isCallChatOpen={isCallChatVisible}
            onToggleCallChat={canUseCallChat ? onToggleCallChat : undefined}
            unreadCallChatCount={unreadCallChatCount}
            hideThreadChat={hideThreadChat}
            hideAIAssistant={hideAIAssistant}
            hideMinimize={hideMinimize}
            isExternalUser={isExternalUser}
            isHost={isHost}
            isRecording={isRecordingActive}
            canStopRecording={canStopRecording}
            onStartRecording={handleStartRecording}
            onStopRecording={handleStopRecording}
            onTogglePresentationMode={
              isTelepresenceEnabled ? () => setIsPresentationMode(prev => !prev) : undefined
            }
            isPresentationMode={isPresentationMode}
            hidePresentationMode={!isTelepresenceEnabled}
          />
        </div>
      </CallStateTransition>

      {/* Call Chat Panel - Left Sidebar */}
      {isCallChatVisible && onToggleCallChat && (
        <div className='fixed left-0 top-0 h-full w-full md:w-[400px] bg-background shadow-xl z-[60]'>
          <CallChatPanel
            room={room}
            externalId={callId}
            localParticipantId={localParticipantId}
            onClose={onToggleCallChat}
            onNewMessage={onCallChatNewMessage}
            isExternalUser={isExternalUser}
          />
        </div>
      )}

      {/* Thread Panel - Sidebar */}
      {isChatOpen && channelId && conversationId && (
        <div className='fixed right-0 top-0 h-full w-full md:w-[500px] bg-background shadow-xl z-[60]'>
          <ThreadMessages
            channelId={channelId}
            conversationId={conversationId}
            ticketId={null}
            onClose={onToggleThread}
          />
        </div>
      )}

      {/* Participants Sidebar */}
      {isParticipantsSidebarOpen && (
        <div className='fixed right-0 top-0 h-full w-full md:w-[500px] bg-background shadow-xl z-[60]'>
          <ParticipantsSidebar
            callId={callId}
            onClose={handleToggleParticipantsSidebar}
            callParticipants={callParticipants}
            isHost={isHostProp}
            currentUserId={currentUserId}
            onApproveLobbyRequest={onApproveLobbyRequest}
            onRejectLobbyRequest={onRejectLobbyRequest}
            hideInvite={hideInvite}
            raisedHands={raisedHands}
          />
        </div>
      )}

      {isHostControlsOpen && isHostProp && (
        <div className='fixed right-0 top-0 h-full w-full md:w-[500px] bg-background shadow-xl z-[60]'>
          <HostControlsPanel callId={callId} onClose={handleToggleHostControls} />
        </div>
      )}

      {/* Control Request Dialog */}
      {pendingControlRequest && localParticipantId === aiController?.id && (
        <ControlRequestDialog
          isOpen={true}
          requesterName={pendingControlRequest.requesterName}
          onApprove={() => roomActor.send({ type: 'APPROVE_CONTROL_REQUEST' })}
          onDeny={() => roomActor.send({ type: 'DENY_CONTROL_REQUEST' })}
        />
      )}

      {/* Rename-on-stop popup. Skipping keeps the prefilled name; either way the
          recording is stopped and saved. */}
      {stopDialog && (
        <RecordingStopDialog
          defaultName={stopDialog.defaultName}
          onConfirm={name => void finalizeStopRecording(name)}
          onDismiss={() => void finalizeStopRecording()}
        />
      )}

      {/* Presentation Mode Overlay — handles fullscreen + smooth fade transition */}
      <PresentationModeOverlay
        callId={callId}
        isOpen={isPresentationMode}
        participant={presentationParticipant ?? null}
        aiController={aiController}
        requestedAiController={requestedAiController}
        onExit={() => setIsPresentationMode(false)}
      />
    </div>
  );
}
