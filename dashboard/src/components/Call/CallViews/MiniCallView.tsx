import { motion } from 'framer-motion';
import type { ParticipantInfo } from '../../../machines/roomMachine';
import { roomActor } from '../../../machines/roomMachine';
import type { Room } from 'livekit-client';
import { ConnectionState, Track } from 'livekit-client';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../../utils/classNames';
import ThreadMessages from '../../Chat/ThreadPannel';
import { CallControls } from '../CallControls/CallControls';
import { CallStateTransition } from '../CallStateTransition/CallStateTransition';
import { ParticipantGrid } from '../ParticipantGrid/ParticipantGrid';
import { ScreenShareView } from '../ScreenShareView/ScreenShareView';
import { ControlRequestDialog } from '../CallModals/ControlRequestDialog';
import { ParticipantsSidebar } from '../ParticipantsSidebar/ParticipantsSidebar';

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
  pendingControlRequest,
  onToggleMic,
  onToggleCamera,
  onToggleScreenShare,
  onDisconnect,
  onExpand,
  onToggleThread,
  onRequestControl,
}: MiniCallViewProps): React.ReactElement {
  const participantCount = participants.length;
  const containerRef = useRef<HTMLDivElement>(null);

  // State for resizing
  const [size, setSize] = useState({ width: 380, height: 280 });
  const [isResizing, setIsResizing] = useState<'right' | 'bottom' | 'corner' | null>(null);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  // State for participants sidebar
  const [isParticipantsSidebarOpen, setIsParticipantsSidebarOpen] = useState(false);

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

  // Resize handles component (reusable)
  const ResizeHandles = ({ showCorner = false }: { showCorner?: boolean }): React.ReactElement => (
    <>
      {/* Right edge resize handle */}
      <div
        role='button'
        tabIndex={0}
        aria-label='Resize width'
        className='absolute top-0 right-0 w-1 h-full cursor-ew-resize z-20'
        onMouseDown={e => handleResizeStart(e, 'right')}
        onPointerDown={(e): void => e.stopPropagation()}
        onKeyDown={(e): void => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
          }
        }}
      />

      {/* Bottom-right corner resize handle */}
      {showCorner && (
        <div
          role='button'
          tabIndex={0}
          aria-label='Resize width and height'
          className='absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-30'
          onMouseDown={e => handleResizeStart(e, 'corner')}
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

  return (
    <>
      <motion.div
        drag
        dragMomentum={false}
        dragElastic={0}
        dragConstraints={{
          top: -(window.innerHeight - size.height - (isChatOpen ? 410 : 0) - 20),
          left: -20,
          right: window.innerWidth - size.width - 20,
          bottom: 20,
        }}
        dragListener={!isResizing}
        whileDrag={{ cursor: 'grabbing' }}
        className='fixed z-50 group/container'
        style={{
          bottom: '20px',
          left: '20px',
        }}
      >
        <div className='flex flex-col relative'>
          {/* Call Window */}
          <div
            ref={containerRef}
            className={cn(
              'bg-gradient-to-br from-gray-900 to-gray-950 shadow-2xl overflow-hidden border-2 backdrop-blur-sm relative',
              'border-gray-700/50',
            )}
            style={{
              width: `${size.width}px`,
              height: `${size.height}px`,
              borderRadius: isChatOpen ? '12px 12px 0 0' : '12px',
            }}
            data-testid='call-window'
          >
            <ResizeHandles showCorner={!isChatOpen} />

            <CallStateTransition connectionState={connectionState} machineState={machineState}>
              {/* Normal connected state - show call UI */}
              <div className='h-full flex flex-col'>
                {/* Header - Draggable */}
                <div className='cursor-grab active:cursor-grabbing bg-gradient-to-r from-gray-800 to-gray-900 px-3 py-2.5 flex items-center justify-between border-b border-gray-700/50'>
                  <div className='flex items-center gap-2'>
                    <div className='relative'>
                      <div className='w-2 h-2 bg-green-500 rounded-full'></div>
                      <div className='absolute inset-0 w-2 h-2 bg-green-500 rounded-full animate-ping'></div>
                    </div>
                    <span className='text-white text-xs font-semibold'>Call Active</span>
                    <span className='text-gray-400 text-xs'>·</span>
                    <span className='text-gray-400 text-xs' data-testid='participant-count'>
                      {participantCount} participant{participantCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>

                {/* Video Grid */}
                <div
                  className='flex-1 bg-gray-950/50 p-3 overflow-auto'
                  onPointerDown={(e): void => e.stopPropagation()}
                >
                  {focusedScreenShare ? (
                    // Screen share layout with sidebar
                    <div className='h-full'>
                      <ScreenShareView
                        focusedScreenShare={focusedScreenShare}
                        screenSharingCount={screenSharingParticipants.length}
                        participants={participants}
                        onScreenShareClick={handleScreenShareClick}
                        className='h-full'
                        compact={true}
                        showSidebar={true}
                      />
                    </div>
                  ) : (
                    // Normal grid layout when no screen share
                    <div className='h-full'>
                      <ParticipantGrid
                        participants={participants}
                        compact={true}
                        aiController={aiController}
                        requestedAiController={requestedAiController}
                      />
                    </div>
                  )}
                </div>

                {/* Controls */}
                <div className='pb-4' onPointerDown={(e): void => e.stopPropagation()}>
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
                    onToggleView={onExpand}
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
                  />
                </div>
              </div>
            </CallStateTransition>
          </div>

          {/* Thread Panel - Below Call */}
          {isChatOpen && channelId && conversationId && (
            <div
              className='bg-white shadow-2xl border-2 border-gray-200 border-t-0 overflow-hidden relative'
              style={{
                width: `${size.width}px`,
                height: '400px',
                borderRadius: '0 0 12px 12px',
              }}
            >
              <ThreadMessages
                channelId={channelId}
                conversationId={conversationId}
                onClose={onToggleThread}
              />

              <ResizeHandles showCorner={true} />
            </div>
          )}

          {/* Participants Sidebar - Below Call */}
          {isParticipantsSidebarOpen && (
            <div
              className='bg-white shadow-2xl border-2 border-gray-200 border-t-0 overflow-hidden relative h-[400px] rounded-b-xl'
              style={{ width: `${size.width}px` }}
            >
              <ParticipantsSidebar
                callId={callId}
                onClose={() => setIsParticipantsSidebarOpen(false)}
              />

              <ResizeHandles showCorner={true} />
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
    </>
  );
}
