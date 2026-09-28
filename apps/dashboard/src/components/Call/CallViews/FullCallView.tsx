import type { Room } from 'livekit-client';
import { ConnectionQuality, ConnectionState } from 'livekit-client';
import { Minimize2, MonitorUp, WifiLow } from 'lucide-react';
import { useSelector } from '@xstate/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  useParticipantNetworkQuality,
  useNetworkQualityToast,
} from '../hooks/useParticipantNetworkQuality';
import { InvitationResponse, type RecordingType } from '@xyne/shared';
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
import { ParticipantsPill } from '../ParticipantsPill/ParticipantsPill';
import { CallNotesPanel } from '../CallNotesPanel/CallNotesPanel';
import { getRingingInvitees, useIsDmCall } from '../ringStatus.utils';
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

/** Wall-clock time for the bottom-left of the bar. Polled every 10s so the minute flips promptly. */
function useClockLabel(): string {
  const format = (): string =>
    new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const [label, setLabel] = useState(format);
  useEffect(() => {
    const interval = setInterval(() => setLabel(format()), 10_000);
    return (): void => clearInterval(interval);
  }, []);
  return label;
}

type SidePanel = 'participants' | 'notes' | 'callChat' | 'thread';

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
        readonly ringStatus?: string | null | undefined;
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
  const [isNotesOpen, setIsNotesOpen] = useState(false);
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

  // Meet shows one side panel at a time: opening any panel closes the others.
  // People (which also holds host controls and the agent) and Notes are local
  // state; the two chats are owned upstream.
  const closePanelsExcept = useCallback(
    (keep: SidePanel): void => {
      if (keep !== 'participants') setIsParticipantsSidebarOpen(false);
      if (keep !== 'notes') setIsNotesOpen(false);
      if (keep !== 'thread' && isChatOpen) onToggleThread();
      if (keep !== 'callChat' && isCallChatOpen && onToggleCallChat) onToggleCallChat();
    },
    [isChatOpen, onToggleThread, isCallChatOpen, onToggleCallChat],
  );

  const handleToggleParticipantsSidebar = useCallback((): void => {
    if (!isParticipantsSidebarOpen) closePanelsExcept('participants');
    setIsParticipantsSidebarOpen(!isParticipantsSidebarOpen);
  }, [isParticipantsSidebarOpen, closePanelsExcept]);

  // Shared notes canvas (series-wide for recurring calls).
  const handleToggleNotes = useCallback((): void => {
    if (!isNotesOpen) closePanelsExcept('notes');
    setIsNotesOpen(!isNotesOpen);
  }, [isNotesOpen, closePanelsExcept]);

  const handleToggleThread = useCallback((): void => {
    if (!isChatOpen) closePanelsExcept('thread');
    onToggleThread();
  }, [isChatOpen, closePanelsExcept, onToggleThread]);

  const handleToggleCallChat = useCallback((): void => {
    if (!onToggleCallChat) return;
    if (!isCallChatOpen) closePanelsExcept('callChat');
    onToggleCallChat();
  }, [isCallChatOpen, closePanelsExcept, onToggleCallChat]);

  // Chat can also be opened from outside the call UI — keep local panels closed then.
  useEffect(() => {
    if (isChatOpen || isCallChatOpen) {
      setIsParticipantsSidebarOpen(false);
      setIsNotesOpen(false);
    }
  }, [isChatOpen, isCallChatOpen]);

  // Show toast for incoming call chat messages
  useCallChatNotifications(room, localParticipantId, onCallChatNewMessage);

  const hasExternalJoined = useMemo(() => {
    return hasJoinedExternalParticipant(callParticipants);
  }, [callParticipants]);

  // Ring tiles are DM-only; elsewhere the sidebar carries ring status.
  const isDmCall = useIsDmCall(channelId);
  const ringingInvitees = useMemo(
    () =>
      isExternalUser || !isDmCall
        ? []
        : getRingingInvitees(
            callParticipants,
            new Set(participants.map(p => p.identity)),
            currentUserId !== undefined ? currentUserId : user?.id,
          ),
    [isExternalUser, isDmCall, callParticipants, participants, currentUserId, user?.id],
  );

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

  const activePanel: SidePanel | null = isParticipantsSidebarOpen
    ? 'participants'
    : isNotesOpen && !isExternalUser
      ? 'notes'
      : isCallChatVisible && onToggleCallChat
        ? 'callChat'
        : isChatOpen && channelId && conversationId
          ? 'thread'
          : null;

  const activeCalls = useSelector(roomActor, state => state.context.activeCalls);
  const currentCall = useMemo(
    () =>
      (
        activeCalls as Array<{
          externalId: string;
          title?: string | null;
          participants?: Array<{ response?: string | null }>;
        }>
      ).find(c => c.externalId === callId),
    [activeCalls, callId],
  );
  const callTitle = currentCall?.title ?? null;
  // Anyone in the call can admit people, so everyone sees the waiting count.
  const joinRequestCount = useMemo(
    () =>
      (callParticipants ?? currentCall?.participants ?? []).filter(
        p => p.response === InvitationResponse.REQUESTED,
      ).length,
    [callParticipants, currentCall?.participants],
  );
  const clockLabel = useClockLabel();
  const isLocalHandRaised = !!localParticipantId && raisedHands.includes(localParticipantId);

  const renderStage = (): React.ReactElement => {
    if (isWhiteboardOpen) {
      return (
        <CallWhiteboardView
          participants={participants}
          room={room}
          className='h-full'
          showSidebar={true}
          aiController={aiController}
          requestedAiController={requestedAiController}
        />
      );
    }
    if (focusedScreenShare) {
      return (
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
        />
      );
    }
    return (
      <ParticipantGrid
        participants={participants}
        ringingInvitees={ringingInvitees}
        aiController={aiController}
        requestedAiController={requestedAiController}
        raisedHands={raisedHands}
      />
    );
  };

  const renderPanel = (): React.ReactNode => {
    switch (activePanel) {
      case 'participants':
        return (
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
            onToggleHandRaise={onToggleHandRaise}
            hostName={hostName}
            agentControls={
              hideAIAssistant
                ? undefined
                : { localParticipantId, requestedAiController, onRequestControl }
            }
          />
        );
      case 'notes':
        return <CallNotesPanel callId={callId} channelId={channelId} onClose={handleToggleNotes} />;
      case 'callChat':
        return (
          <CallChatPanel
            room={room}
            externalId={callId}
            localParticipantId={localParticipantId}
            onClose={handleToggleCallChat}
            onNewMessage={onCallChatNewMessage}
            isExternalUser={isExternalUser}
          />
        );
      case 'thread':
        return channelId && conversationId ? (
          <ThreadMessages
            channelId={channelId}
            conversationId={conversationId}
            ticketId={null}
            onClose={handleToggleThread}
          />
        ) : null;
      default:
        return null;
    }
  };

  return (
    <div
      className='relative flex h-screen flex-col overflow-hidden bg-[#131314]'
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

      {/* Top strip, keeping the stage chrome-free (Meet's layout). Left: transcription
          and recording status. Centre: the "you're presenting" reminder. Right:
          connection trouble, People and Minimize. Leaves room for the macOS traffic
          lights in Electron. */}
      <div
        className={cn(
          'relative flex h-14 shrink-0 items-center justify-between gap-3 pr-3 sm:pr-4',
          isElectron && isMac ? 'pl-24' : 'pl-3 sm:pl-4',
        )}
      >
        <div className='flex min-w-0 items-center gap-2 sm:gap-3'>
          <CallPrivacyIndicator
            isTranscriptionEnabled={isTranscriptionEnabled}
            isHost={isHost}
            hostName={hostName}
            onToggleTranscription={() => roomActor.send({ type: 'TOGGLE_TRANSCRIPTION' })}
            isRecordingActive={isRecordingActive}
            recordingType={displayRecordingType}
            trackMetadata={{
              isRecordingActive,
              recordingType: displayRecordingType,
            }}
          />
          {isRecordingActive && (
            <span
              className='flex h-10 items-center gap-2 rounded-full bg-transparent px-3.5 text-sm font-semibold text-[#f28b82] ring-1 ring-inset ring-[#f28b82]/40'
              title={
                displayActiveRecording?.startedByName
                  ? `Recording started by ${displayActiveRecording.startedByName}`
                  : 'This call is being recorded'
              }
            >
              <span className='inline-block h-2 w-2 animate-pulse rounded-full bg-[#ea4335]' />
              REC <span className='tabular-nums'>{recordingElapsed}</span>
            </span>
          )}
        </div>
        {/* Meet's "you're presenting" reminder, with a one-click stop */}
        {isScreenSharing && (
          <div className='absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-full bg-[#333537] py-1 pl-3 pr-1 text-sm text-[#e3e3e3] md:flex'>
            <MonitorUp className='h-4 w-4 text-[#a8c7fa]' />
            <span className='whitespace-nowrap'>You&apos;re presenting to everyone</span>
            <button
              type='button'
              onClick={onToggleScreenShare}
              className='rounded-full bg-[#a8c7fa] px-3 py-1 text-xs font-medium text-[#062e6f] transition-colors hover:bg-[#bcd4fb]'
              data-track-category='CALLS'
              data-track-name='TOGGLE_SCREEN_SHARE'
              data-track-metadata={JSON.stringify({
                callId,
                enabled: true,
                source: 'presenting_banner',
              })}
            >
              Stop presenting
            </button>
          </div>
        )}
        <div className='flex items-center gap-2 sm:gap-3'>
          <ConnectionStatusIndicators room={room} hideWhenHealthy />
          <ParticipantsPill
            participants={participants}
            requestCount={joinRequestCount}
            raisedHandCount={raisedHands.length}
            isOpen={activePanel === 'participants'}
            onClick={handleToggleParticipantsSidebar}
          />
          {!hideMinimize && (
            <button
              type='button'
              onClick={onMinimize}
              className='flex h-10 items-center gap-2 rounded-full bg-[#333537] px-3 text-sm font-medium text-[#e3e3e3] outline-none transition-colors hover:bg-[#404245] focus-visible:ring-2 focus-visible:ring-[#a8c7fa] focus-visible:ring-offset-2 focus-visible:ring-offset-[#131314] sm:pl-3 sm:pr-4'
              title='Minimize to a floating window'
              aria-label='Minimize call'
              data-track-category='CALLS'
              data-track-name='TOGGLE_VIEW_MODE'
              data-track-metadata={JSON.stringify({ callId, viewMode: 'full', source: 'top_bar' })}
            >
              <Minimize2 className='h-4 w-4' />
              <span className='hidden sm:inline'>Minimize</span>
            </button>
          )}
        </div>
      </div>

      <CallStateTransition connectionState={connectionState} machineState={machineState}>
        <div className='flex min-h-0 flex-1'>
          <main className='relative min-w-0 flex-1 overflow-hidden'>{renderStage()}</main>

          {/* Side panel — docked card beside the stage (the stage shrinks rather
              than being covered); full-screen sheet on small screens. */}
          {activePanel && (
            <aside className='fixed inset-0 z-[60] overflow-hidden bg-background shadow-2xl animate-in fade-in slide-in-from-right-4 duration-200 md:static md:z-auto md:my-4 md:mr-4 md:w-[360px] md:shrink-0 md:rounded-2xl lg:w-[400px]'>
              {renderPanel()}
            </aside>
          )}
        </div>

        {/* Control bar */}
        <div className='relative z-50 shrink-0'>
          <CallControls
            isMicEnabled={isMicEnabled}
            isCameraEnabled={isCameraEnabled}
            isScreenSharing={isScreenSharing}
            isAnySharingScreen={!!focusedScreenShare}
            isChatOpen={activePanel === 'thread'}
            isParticipantsSidebarOpen={activePanel === 'participants'}
            isNotesOpen={activePanel === 'notes'}
            onToggleNotes={isExternalUser ? undefined : handleToggleNotes}
            isAIAssistantEnabled={isAIAssistantEnabled}
            aiController={aiController}
            localParticipantId={localParticipantId}
            callId={callId}
            roomLink={roomLink}
            onToggleMic={onToggleMic}
            onToggleCamera={onToggleCamera}
            onToggleScreenShare={onToggleScreenShare}
            onDisconnect={onDisconnect}
            onToggleChat={handleToggleThread}
            onToggleParticipantsSidebar={handleToggleParticipantsSidebar}
            onToggleAIAssistant={() => roomActor.send({ type: 'TOGGLE_AI_ASSISTANT' })}
            onSendReaction={sendReaction}
            onRequestControl={onRequestControl}
            viewMode='full'
            requestedAiController={requestedAiController}
            pendingControlRequest={pendingControlRequest}
            isCallChatOpen={activePanel === 'callChat'}
            onToggleCallChat={canUseCallChat && onToggleCallChat ? handleToggleCallChat : undefined}
            unreadCallChatCount={unreadCallChatCount}
            hideThreadChat={hideThreadChat}
            hideAIAssistant={hideAIAssistant}
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
            isHandRaised={isLocalHandRaised}
            onToggleHandRaise={onToggleHandRaise}
            infoSlot={
              <div className='flex min-w-0 items-center gap-3 text-base font-medium text-[#e3e3e3]'>
                <span className='shrink-0 tabular-nums'>{clockLabel}</span>
                {callTitle && (
                  <>
                    <span aria-hidden className='h-5 w-px shrink-0 bg-white/25' />
                    <span className='truncate' title={callTitle}>
                      {callTitle}
                    </span>
                  </>
                )}
              </div>
            }
          />
        </div>
      </CallStateTransition>

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
        onExit={() => setIsPresentationMode(false)}
      />
    </div>
  );
}
