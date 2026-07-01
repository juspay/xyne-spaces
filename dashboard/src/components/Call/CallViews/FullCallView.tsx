import type { Room } from 'livekit-client';
import { ConnectionQuality, ConnectionState, Track } from 'livekit-client';
import { WifiLow } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
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
import { ScreenShareView } from '../ScreenShareView/ScreenShareView';
import { ControlRequestDialog } from '../CallModals/ControlRequestDialog';
import { ParticipantsSidebar } from '../ParticipantsSidebar/ParticipantsSidebar';
import { ConnectionStatusIndicators } from '../ConnectionStatusIndicators/ConnectionStatusIndicators';
import { sendDrawEvent } from '../../../hooks/useDrawStore';
import { useReactions } from '../hooks/useReactions';
import { ReactionsOverlay } from '../components/ReactionsOverlay';
import { CallChatPanel } from '../CallChatPanel/CallChatPanel';
import { useCallChatNotifications } from '../hooks/useCallChatNotifications';
import { recordingService } from '../../../services/Recording/recordingService';
import { useActiveRecording } from '../hooks/useActiveRecording';
import { RecordingStopDialog } from '../CallControls/RecordingStopDialog';

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
}: FullCallViewProps): React.ReactElement {
  // ALL HOOKS MUST BE DECLARED BEFORE ANY CONDITIONAL RETURNS
  // UI state
  const [focusedScreenShareIdentity, setFocusedScreenShareIdentity] = useState<string | null>(null);
  const [isParticipantsSidebarOpen, setIsParticipantsSidebarOpen] = useState(false);
  // Track local participant's network quality
  const networkQuality = useParticipantNetworkQuality(room?.localParticipant ?? null);
  const showQualityToast = useNetworkQualityToast(networkQuality);

  const isHost = isHostProp ?? false;

  // Active-recording state is driven by room metadata so every participant (incl.
  // late joiners) sees the indicator. `isRecordingProp`/optimistic local state are
  // only fallbacks for the brief window before metadata propagates.
  const activeRecording = useActiveRecording(room);
  const [optimisticRecording, setOptimisticRecording] = useState(false);
  const isRecordingActive = !!activeRecording || optimisticRecording || isRecordingProp;

  // Only the participant who started the recording may stop it (mirrors the
  // backend starter-only authz). When we started it optimistically and metadata
  // hasn't propagated yet, treat ourselves as the starter.
  const canStopRecording = activeRecording
    ? activeRecording.startedBy === currentUserId
    : optimisticRecording;

  // Reconcile optimistic flag once authoritative metadata arrives.
  useEffect(() => {
    if (activeRecording) setOptimisticRecording(true);
    else setOptimisticRecording(false);
  }, [activeRecording]);

  // Elapsed recording timer (MM:SS) from the recording's start time.
  const recordingStartedAt = activeRecording?.startedAt ?? null;
  const [recordingElapsed, setRecordingElapsed] = useState('00:00');
  useEffect(() => {
    if (!recordingStartedAt) {
      setRecordingElapsed('00:00');
      return;
    }
    const tick = (): void => {
      const seconds = Math.max(0, Math.floor((Date.now() - recordingStartedAt) / 1000));
      const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
      const ss = String(seconds % 60).padStart(2, '0');
      setRecordingElapsed(`${mm}:${ss}`);
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

  const handleStartRecording = useCallback(
    async (type: RecordingType): Promise<void> => {
      setOptimisticRecording(true);
      try {
        const res = await recordingService.startCallRecording(callId, type);
        if (res.alreadyActive) {
          // Someone else already started one — metadata reflects the real state.
          setOptimisticRecording(false);
        }
      } catch (err) {
        console.error('[Recording] start error', err);
        setOptimisticRecording(false);
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
      try {
        await recordingService.stopCallRecording(callId, {
          ...(recordingId ? { recordingId } : {}),
          ...(name ? { name } : {}),
        });
      } catch (err) {
        console.error('[Recording] stop error', err);
      }
    },
    [callId, stopDialog],
  );

  // Reactions
  const { reactions, sendReaction } = useReactions(room);

  // Get call title and origin from activeCalls

  // Get all participants sharing screen
  // In native mode, use isScreenShareEnabled flag; in web mode, check the actual track publication
  const screenSharingParticipants = participants.filter(p => {
    // If no participant object (native mode), use the isScreenShareEnabled flag
    if (!p.participant) {
      return p.isScreenShareEnabled;
    }
    // Web mode: check actual track publication
    return p.participant.getTrackPublication(Track.Source.ScreenShare)?.isSubscribed;
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
      return !prev;
    });
  }, [isChatOpen, onToggleThread, isCallChatOpen, onToggleCallChat]);

  // Close participants sidebar when chat opens
  useEffect(() => {
    if (isChatOpen && isParticipantsSidebarOpen) {
      setIsParticipantsSidebarOpen(false);
    }
  }, [isChatOpen, isParticipantsSidebarOpen]);

  // Show toast for incoming call chat messages
  useCallChatNotifications(room, localParticipantId, onCallChatNewMessage);

  // Determine if any right sidebar is open (for layout adjustments)
  const isRightSidebarOpen = isChatOpen || isParticipantsSidebarOpen;

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
      <div className='flex justify-between items-center px-4 py-3'>
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
                  activeRecording?.startedByName
                    ? `Recording started by ${activeRecording.startedByName}`
                    : 'This call is being recorded'
                }
              >
                <span className='w-2 h-2 bg-red-500 rounded-full animate-pulse inline-block' />
                REC {recordingElapsed}
              </span>
            </>
          )}
        </div>
        <ConnectionStatusIndicators room={room} />
      </div>

      <CallStateTransition connectionState={connectionState} machineState={machineState}>
        {focusedScreenShare ? (
          // Screen share layout with sidebar
          <div
            className='flex-1 w-full pb-32 sm:pb-36 transition-all duration-300 overflow-hidden'
            style={{
              paddingRight: isRightSidebarOpen ? 'min(500px, 100vw)' : '0',
              paddingLeft: isCallChatOpen ? 'min(400px, 100vw)' : '0',
            }}
          >
            <ScreenShareView
              focusedScreenShare={focusedScreenShare}
              screenSharingCount={screenSharingParticipants.length}
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
              paddingLeft: isCallChatOpen ? 'min(400px, 100vw)' : '0',
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
              ? `translateX(calc(-50% - min(250px, 50vw)${isCallChatOpen ? ' + min(200px, 50vw)' : ''}))`
              : isCallChatOpen
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
            isCallChatOpen={isCallChatOpen}
            onToggleCallChat={onToggleCallChat}
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
          />
        </div>
      </CallStateTransition>

      {/* Call Chat Panel - Left Sidebar */}
      {isCallChatOpen && onToggleCallChat && (
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
    </div>
  );
}
