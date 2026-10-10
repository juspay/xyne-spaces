import { motion } from 'framer-motion';
import type { ParticipantInfo } from '../../../machines/roomMachine';
import { roomActor } from '../../../machines/roomMachine';
import type { Room } from 'livekit-client';
import { ConnectionState } from 'livekit-client';
import {
  ChevronsDown,
  ChevronsUp,
  Loader2,
  Maximize2,
  MessageSquare,
  Mic,
  MicOff,
  PhoneOff,
} from 'lucide-react';
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../../utils/classNames';
import { CallControls } from '../CallControls/CallControls';
import { CallStateTransition } from '../CallStateTransition/CallStateTransition';
import { ParticipantGrid } from '../ParticipantGrid/ParticipantGrid';
import { findPresentationParticipant } from '../ParticipantGrid/sortParticipants';
import { ScreenShareView } from '../ScreenShareView/ScreenShareView';
import { ControlRequestDialog } from '../CallModals/ControlRequestDialog';
import { ParticipantsSidebar } from '../ParticipantsSidebar/ParticipantsSidebar';
import { getRingingInvitees, useIsDmCall } from '../ringStatus.utils';
import { useCallChatNotifications } from '../hooks/useCallChatNotifications';
import { isScreenShareActive } from '../../../utils/livekitScreenShare';
import { isTranscriptionAgentIdentity } from '../../../utils/livekitAgent';
import { useAuth } from '../../../hooks/useAuth';
import { useTelepresenceEnabled } from '../useTelepresenceEnabled';
import { useAutoPresentationMode } from '../useAutoPresentationMode';
import {
  LazyCallWhiteboardView,
  LazyPresentationModeOverlay,
  LazyThreadMessages,
  MountOnceOpen,
  PanelLoading,
} from '../lazyPanels';
import { useCallWhiteboardStore } from '../../../stores/callWhiteboardStore';
import Tooltip from '../../ui/Tooltip';

const LINE_VIEW_HEIGHT = 40;

interface MiniCallViewProps {
  participants: ParticipantInfo[];
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  isScreenSharing: boolean;
  isAIAssistantEnabled: boolean;
  aiController: { id: string; name: string } | null;
  requestedAiController: boolean;
  localParticipantId: string | null;
  connectionState: ConnectionState;
  machineState: string;
  callId: string;
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
  onExpand: () => void;
  onToggleThread: () => void;
  onRequestControl?: () => void;
  /** Call participants data for sidebar (lobby approve/reject) */
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
  isHost?: boolean | undefined;
  currentUserId?: string | null | undefined;
  onApproveLobbyRequest?: ((participantId: string) => void) | undefined;
  onRejectLobbyRequest?: ((participantId: string) => void) | undefined;
  /** Called when a new remote call chat message arrives (for unread tracking) */
  onCallChatNewMessage?: (() => void) | undefined;
  /** Identities of participants with hand raised (synced via data channel) */
  raisedHands?: string[] | undefined;
  /** Toggle the local participant's raised hand */
  onToggleHandRaise?: (() => void) | undefined;
}

// Declared at module level so React keeps one component identity across renders.
function HeaderActionButton({
  callId,
  label,
  onClick,
  children,
  danger = false,
  trackName,
}: {
  callId: string;
  label: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  trackName: string;
}): React.ReactElement {
  return (
    <Tooltip content={label} side='bottom'>
      <button
        type='button'
        aria-label={label}
        title={label}
        onClick={onClick}
        onPointerDown={(e): void => e.stopPropagation()}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors',
          danger
            ? 'bg-[#dc362e] text-white hover:bg-[#e3554e]'
            : 'bg-[#333537] text-[#e3e3e3] hover:bg-[#404245]',
        )}
        data-track-category='CALLS'
        data-track-name={trackName}
        data-track-metadata={JSON.stringify({ callId })}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function ResizeHandles({
  showCorner = false,
  onResizeStart,
}: {
  showCorner?: boolean;
  onResizeStart: (e: React.MouseEvent, edge: 'right' | 'bottom' | 'corner') => void;
}): React.ReactElement {
  return (
    <>
      <div
        role='button'
        tabIndex={0}
        aria-label='Resize width'
        className='absolute top-0 right-0 w-1 h-full cursor-ew-resize z-20'
        onMouseDown={e => onResizeStart(e, 'right')}
        data-track-category='CALLS'
        data-track-name='RESIZE_MINI_CALL_WIDTH'
        onPointerDown={(e): void => e.stopPropagation()}
        onKeyDown={(e): void => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
          }
        }}
      />
      {showCorner && (
        <div
          role='button'
          tabIndex={0}
          aria-label='Resize width and height'
          className='absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-30'
          onMouseDown={e => onResizeStart(e, 'corner')}
          data-track-category='CALLS'
          data-track-name='RESIZE_MINI_CALL_CORNER'
          onPointerDown={(e): void => e.stopPropagation()}
          onKeyDown={(e): void => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
            }
          }}
        />
      )}
    </>
  );
}

export function MiniCallView({
  participants,
  isMicEnabled,
  isCameraEnabled,
  isScreenSharing,
  isAIAssistantEnabled,
  aiController,
  requestedAiController,
  localParticipantId,
  connectionState,
  machineState,
  callId,
  roomLink,
  isChatOpen,
  channelId,
  conversationId,
  room,
  pendingControlRequest,
  onToggleMic,
  onToggleCamera,
  onToggleScreenShare,
  onDisconnect,
  onExpand,
  onToggleThread,
  onRequestControl,
  callParticipants,
  isHost: isHostProp,
  currentUserId,
  onApproveLobbyRequest,
  onRejectLobbyRequest,
  onCallChatNewMessage,
  raisedHands = [],
  onToggleHandRaise,
}: MiniCallViewProps): React.ReactElement {
  const { user } = useAuth();
  const isTelepresenceEnabled = useTelepresenceEnabled(user?.email);
  const isWhiteboardOpen = useCallWhiteboardStore(s => s.isOpen);

  // People only — the Xyne Automatic agent isn't counted.
  const participantCount = participants.filter(
    p => !isTranscriptionAgentIdentity(p.identity),
  ).length;

  // Ring tiles are DM-only; elsewhere the sidebar carries ring status.
  const isDmCall = useIsDmCall(channelId);
  const ringingInvitees = useMemo(
    () =>
      isDmCall
        ? getRingingInvitees(
            callParticipants,
            new Set(participants.map(p => p.identity)),
            currentUserId !== undefined ? currentUserId : user?.id,
          )
        : [],
    [isDmCall, callParticipants, participants, currentUserId, user?.id],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const dragBoundsRef = useRef<HTMLDivElement>(null);
  const [overlayMode, setOverlayMode] = useState<'mini' | 'line'>('mini');
  const [miniLeft, setMiniLeft] = useState(20);

  // State for resizing
  const [size, setSize] = useState({ width: 380, height: 280 });
  const [isResizing, setIsResizing] = useState<'right' | 'bottom' | 'corner' | null>(null);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  // Show toast for incoming call chat messages
  useCallChatNotifications(room, localParticipantId, onCallChatNewMessage);

  // State for participants sidebar
  const [isParticipantsSidebarOpen, setIsParticipantsSidebarOpen] = useState(false);
  const [isPresentationMode, setIsPresentationMode] = useState(false);
  useAutoPresentationMode(isTelepresenceEnabled, setIsPresentationMode);

  // Close participants sidebar when chat opens
  useEffect(() => {
    if (isChatOpen && isParticipantsSidebarOpen) {
      setIsParticipantsSidebarOpen(false);
    }
  }, [isChatOpen, isParticipantsSidebarOpen]);

  // Calculate dynamic icon size based on width
  const iconSize = Math.max(12, Math.min(20, size.width / 25));
  const buttonPadding = Math.max(6, Math.min(10, size.width / 50));

  // State for focused screen share
  const [focusedScreenShareIdentity, setFocusedScreenShareIdentity] = useState<string | null>(null);
  const isLineView = overlayMode === 'line';
  const lineViewWidth = size.width;
  const dockedLineLeft = 76;
  const dockedLineBottom = 20;
  const [lineLeft, setLineLeft] = useState(dockedLineLeft);

  const clampMiniLeft = (left: number): number =>
    Math.max(20, Math.min(left, window.innerWidth - size.width - 20));

  const handleLineViewChatOpen = (): void => {
    if (!isChatOpen) {
      onToggleThread();
    }
    handleExpandToMini();
  };

  const handleExpandToMini = (): void => {
    const renderedLeft = containerRef.current?.getBoundingClientRect().left ?? lineLeft;
    setMiniLeft(clampMiniLeft(renderedLeft));
    setOverlayMode('mini');
  };

  const handleCollapseToLine = (): void => {
    setLineLeft(dockedLineLeft);
    setOverlayMode('line');
  };

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

  const presentationParticipant = useMemo(
    () => findPresentationParticipant(participants, localParticipantId),
    [participants, localParticipantId],
  );

  // Handle clicking on a screen share to focus it
  const handleScreenShareClick = (identity: string): void => {
    setFocusedScreenShareIdentity(identity);
  };

  // Handle resize
  const handleResizeStart = (e: React.MouseEvent, edge: 'right' | 'bottom' | 'corner'): void => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(edge);
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startWidth: size.width,
      startHeight: size.height,
    };
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleResizeMove = (e: MouseEvent): void => {
      if (!resizeRef.current) return;

      const deltaX = e.clientX - resizeRef.current.startX;
      const deltaY = e.clientY - resizeRef.current.startY;

      let newWidth = resizeRef.current.startWidth;
      let newHeight = resizeRef.current.startHeight;

      if (isResizing === 'right' || isResizing === 'corner') {
        newWidth = Math.max(300, Math.min(600, resizeRef.current.startWidth + deltaX));
      }
      if (isResizing === 'bottom' || isResizing === 'corner') {
        newHeight = Math.max(220, Math.min(500, resizeRef.current.startHeight + deltaY));
      }

      setSize({ width: newWidth, height: newHeight });
    };

    const handleResizeEnd = (): void => {
      setIsResizing(null);
      resizeRef.current = null;
    };

    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);

    return (): void => {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
    };
  }, [isResizing]);

  if (isLineView) {
    return (
      <>
        {/* Draggable like the mini window: kept 20px inside the viewport on every
            side. The header buttons stop pointerdown, so clicks never start a drag. */}
        <div ref={dragBoundsRef} className='pointer-events-none fixed inset-5' />
        <motion.div
          // Distinct keys: line and mini views are both motion.divs in the same
          // slot, and without them React reuses one element — carrying this
          // view's drag offset into the other and shoving it off-screen.
          key='line-view'
          drag
          dragMomentum={false}
          dragElastic={0}
          dragConstraints={dragBoundsRef}
          whileDrag={{ cursor: 'grabbing' }}
          className='fixed z-50 group/container cursor-grab'
          style={{
            bottom: `${dockedLineBottom}px`,
            left: `${lineLeft}px`,
          }}
        >
          <div
            ref={containerRef}
            className={cn(
              'bg-[#1e1f20] shadow-2xl overflow-hidden border relative',
              'border-white/10 rounded-full',
            )}
            style={{
              width: `${lineViewWidth}px`,
              height: `${LINE_VIEW_HEIGHT}px`,
            }}
            data-testid='call-window'
          >
            {machineState === 'disconnecting' ? (
              <div className='h-full px-3 py-1 flex items-center gap-2'>
                <Loader2 className='h-4 w-4 animate-spin text-red-400' />
                <span className='text-white text-xs font-semibold whitespace-nowrap'>
                  Leaving...
                </span>
              </div>
            ) : (
              <CallStateTransition connectionState={connectionState} machineState={machineState}>
                <div className='h-full px-3 py-1 flex items-center justify-between gap-3'>
                  <div className='flex items-center gap-2 min-w-0'>
                    <div className='relative visual-regression-hide flex-shrink-0'>
                      <div className='w-2 h-2 bg-green-500 rounded-full'></div>
                      <div className='absolute inset-0 w-2 h-2 bg-green-500 rounded-full animate-ping'></div>
                    </div>
                    <span className='text-white text-xs font-semibold whitespace-nowrap'>
                      Call Active
                    </span>
                  </div>
                  <div className='flex items-center gap-1 flex-shrink-0'>
                    <HeaderActionButton
                      callId={callId}
                      label={isMicEnabled ? 'Mute microphone' : 'Unmute microphone'}
                      onClick={onToggleMic}
                      danger={!isMicEnabled}
                      trackName='TOGGLE_MIC_FROM_LINE_VIEW'
                    >
                      {isMicEnabled ? <Mic className='h-4 w-4' /> : <MicOff className='h-4 w-4' />}
                    </HeaderActionButton>
                    <HeaderActionButton
                      callId={callId}
                      label='Open chat'
                      onClick={handleLineViewChatOpen}
                      trackName='OPEN_CHAT_FROM_LINE_VIEW'
                    >
                      <MessageSquare className='h-4 w-4' />
                    </HeaderActionButton>
                    <HeaderActionButton
                      callId={callId}
                      label='Expand to mini view'
                      onClick={handleExpandToMini}
                      trackName='EXPAND_CALL_TO_MINI_VIEW'
                    >
                      <ChevronsUp className='h-4 w-4' />
                    </HeaderActionButton>
                    <HeaderActionButton
                      callId={callId}
                      label='Expand to full call view'
                      onClick={onExpand}
                      trackName='EXPAND_CALL_TO_FULL_VIEW'
                    >
                      <Maximize2 className='h-4 w-4' />
                    </HeaderActionButton>
                    <HeaderActionButton
                      callId={callId}
                      label='End call'
                      onClick={onDisconnect}
                      danger={true}
                      trackName='END_CALL_FROM_LINE_VIEW'
                    >
                      <PhoneOff className='h-4 w-4' />
                    </HeaderActionButton>
                  </div>
                </div>
              </CallStateTransition>
            )}
          </div>
        </motion.div>
        {/* Control Request Dialog */}
        {pendingControlRequest && localParticipantId === aiController?.id && (
          <ControlRequestDialog
            isOpen={true}
            requesterName={pendingControlRequest.requesterName}
            onApprove={() => roomActor.send({ type: 'APPROVE_CONTROL_REQUEST' })}
            onDeny={() => roomActor.send({ type: 'DENY_CONTROL_REQUEST' })}
          />
        )}

        {/* Presentation Mode Overlay — fullscreen + smooth fade, consistent with FullCallView */}
        <MountOnceOpen open={isPresentationMode}>
          <LazyPresentationModeOverlay
            callId={callId}
            isOpen={isPresentationMode}
            participant={presentationParticipant ?? null}
            onExit={() => setIsPresentationMode(false)}
          />
        </MountOnceOpen>
      </>
    );
  }

  return (
    <>
      <div
        ref={dragBoundsRef}
        className='pointer-events-none fixed left-5 right-5 top-5 bottom-0'
      />
      <motion.div
        key='mini-view'
        drag
        dragMomentum={false}
        dragElastic={0}
        dragConstraints={dragBoundsRef}
        dragListener={!isResizing}
        whileDrag={{ cursor: 'grabbing' }}
        className='fixed z-50 group/container'
        style={{
          bottom: '20px',
          left: `${miniLeft}px`,
        }}
      >
        <div className='flex flex-col relative'>
          {/* Call Window */}
          <div
            ref={containerRef}
            className={cn(
              'bg-[#131314] shadow-2xl overflow-hidden border-2 relative',
              'border-white/10',
            )}
            style={{
              width: `${size.width}px`,
              height: `${size.height}px`,
              borderRadius: isChatOpen ? '12px 12px 0 0' : '12px',
            }}
            data-testid='call-window'
          >
            <ResizeHandles onResizeStart={handleResizeStart} showCorner={!isChatOpen} />

            <CallStateTransition connectionState={connectionState} machineState={machineState}>
              {/* Normal connected state - show call UI */}
              <div className='h-full flex flex-col'>
                {/* Header - Draggable */}
                <div className='cursor-grab active:cursor-grabbing bg-[#131314] px-3 py-1.5 flex items-center justify-between border-b border-white/[0.06]'>
                  <div className='flex items-center gap-2'>
                    <div className='relative visual-regression-hide'>
                      <div className='w-2 h-2 bg-green-500 rounded-full'></div>
                      <div className='absolute inset-0 w-2 h-2 bg-green-500 rounded-full animate-ping'></div>
                    </div>
                    <span className='text-white text-xs font-semibold'>Call Active</span>
                    <span className='text-muted-foreground text-xs'>·</span>
                    <span className='text-muted-foreground text-xs' data-testid='participant-count'>
                      {participantCount} participant{participantCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className='flex items-center gap-1 flex-shrink-0'>
                    <HeaderActionButton
                      callId={callId}
                      label='Switch to line view'
                      onClick={handleCollapseToLine}
                      trackName='COLLAPSE_CALL_TO_LINE_VIEW'
                    >
                      <ChevronsDown className='h-4 w-4' />
                    </HeaderActionButton>
                    {/* Back to the full call screen — mirrors "Minimize" in the full view's top bar */}
                    <Tooltip content='Expand to full screen' side='bottom'>
                      <button
                        type='button'
                        onClick={onExpand}
                        onPointerDown={(e): void => e.stopPropagation()}
                        className='inline-flex h-8 items-center gap-1.5 rounded-full bg-[#333537] pl-2.5 pr-3 text-xs font-medium text-[#e3e3e3] transition-colors hover:bg-[#404245]'
                        aria-label='Expand to full screen'
                        data-track-category='CALLS'
                        data-track-name='TOGGLE_VIEW_MODE'
                        data-track-metadata={JSON.stringify({
                          callId,
                          viewMode: 'mini',
                          source: 'mini_header',
                        })}
                      >
                        <Maximize2 className='h-3.5 w-3.5' />
                        Expand
                      </button>
                    </Tooltip>
                  </div>
                </div>

                {/* Video Grid */}
                <div
                  className='flex-1 bg-[#131314] p-3 overflow-auto'
                  onPointerDown={(e): void => e.stopPropagation()}
                >
                  {isWhiteboardOpen ? (
                    <div className='h-full'>
                      <Suspense fallback={<PanelLoading />}>
                        <LazyCallWhiteboardView
                          participants={participants}
                          room={room}
                          className='h-full'
                          compact={true}
                          showSidebar={true}
                          displayOnly={true}
                          aiController={aiController}
                          requestedAiController={requestedAiController}
                        />
                      </Suspense>
                    </div>
                  ) : focusedScreenShare ? (
                    <div className='h-full'>
                      <ScreenShareView
                        focusedScreenShare={focusedScreenShare}
                        participants={participants}
                        onScreenShareClick={handleScreenShareClick}
                        className='h-full'
                        compact={true}
                        showSidebar={true}
                        allowFullScreen={false}
                        raisedHands={raisedHands}
                        onToggleHandRaise={onToggleHandRaise}
                      />
                    </div>
                  ) : (
                    <div className='h-full'>
                      <ParticipantGrid
                        participants={participants}
                        ringingInvitees={ringingInvitees}
                        compact={true}
                        aiController={aiController}
                        requestedAiController={requestedAiController}
                        raisedHands={raisedHands}
                        onToggleHandRaise={onToggleHandRaise}
                      />
                    </div>
                  )}
                </div>
                <div
                  className='relative z-40 pb-4'
                  onPointerDown={(e): void => e.stopPropagation()}
                >
                  <CallControls
                    isMicEnabled={isMicEnabled}
                    isCameraEnabled={isCameraEnabled}
                    isScreenSharing={isScreenSharing}
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
                    onToggleChat={onToggleThread}
                    onToggleParticipantsSidebar={() => {
                      setIsParticipantsSidebarOpen(prev => {
                        // If opening participants sidebar, close chat
                        if (!prev && isChatOpen) {
                          onToggleThread();
                        }
                        return !prev;
                      });
                    }}
                    onToggleAIAssistant={() => roomActor.send({ type: 'TOGGLE_AI_ASSISTANT' })}
                    onRequestControl={onRequestControl}
                    viewMode='mini'
                    iconSize={iconSize}
                    buttonPadding={buttonPadding}
                    pendingControlRequest={pendingControlRequest}
                    requestedAiController={requestedAiController}
                    onTogglePresentationMode={
                      isTelepresenceEnabled
                        ? (): void => setIsPresentationMode(prev => !prev)
                        : undefined
                    }
                    isPresentationMode={isPresentationMode}
                    hidePresentationMode={!isTelepresenceEnabled}
                  />
                </div>
              </div>
            </CallStateTransition>
          </div>

          {/* Thread Panel - Below Call */}
          {isChatOpen && channelId && conversationId && (
            <div
              className='bg-background shadow-2xl border-2 border-border border-t-0 overflow-hidden relative'
              style={{
                width: `${size.width}px`,
                height: '400px',
                borderRadius: '0 0 12px 12px',
              }}
            >
              <Suspense fallback={<PanelLoading />}>
                <LazyThreadMessages
                  channelId={channelId}
                  conversationId={conversationId}
                  ticketId={null}
                  onClose={onToggleThread}
                />
              </Suspense>

              <ResizeHandles onResizeStart={handleResizeStart} showCorner={true} />
            </div>
          )}

          {/* Participants Sidebar - Below Call */}
          {isParticipantsSidebarOpen && (
            <div
              className='bg-background shadow-2xl border-2 border-border border-t-0 overflow-hidden relative h-[400px] rounded-b-xl'
              style={{ width: `${size.width}px` }}
            >
              <ParticipantsSidebar
                callId={callId}
                onClose={() => setIsParticipantsSidebarOpen(false)}
                callParticipants={callParticipants}
                isHost={isHostProp}
                currentUserId={currentUserId}
                onApproveLobbyRequest={onApproveLobbyRequest}
                onRejectLobbyRequest={onRejectLobbyRequest}
                raisedHands={raisedHands}
              />

              <ResizeHandles onResizeStart={handleResizeStart} showCorner={true} />
            </div>
          )}
        </div>
      </motion.div>
      {/* Control Request Dialog */}
      {pendingControlRequest && localParticipantId === aiController?.id && (
        <ControlRequestDialog
          isOpen={true}
          requesterName={pendingControlRequest.requesterName}
          onApprove={() => roomActor.send({ type: 'APPROVE_CONTROL_REQUEST' })}
          onDeny={() => roomActor.send({ type: 'DENY_CONTROL_REQUEST' })}
        />
      )}

      {/* Presentation Mode Overlay — fullscreen + smooth fade, consistent with FullCallView */}
      <MountOnceOpen open={isPresentationMode}>
        <LazyPresentationModeOverlay
          callId={callId}
          isOpen={isPresentationMode}
          participant={presentationParticipant ?? null}
          onExit={() => setIsPresentationMode(false)}
        />
      </MountOnceOpen>
    </>
  );
}
