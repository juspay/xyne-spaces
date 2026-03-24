import type { Room } from 'livekit-client';
import { ConnectionState, Track } from 'livekit-client';
import { useCallback, useEffect, useState, useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { CallOrigin } from '@xyne/shared';
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
}: FullCallViewProps): React.ReactElement {
  // ALL HOOKS MUST BE DECLARED BEFORE ANY CONDITIONAL RETURNS
  // UI state
  const [focusedScreenShareIdentity, setFocusedScreenShareIdentity] = useState<string | null>(null);
  const [isParticipantsSidebarOpen, setIsParticipantsSidebarOpen] = useState(false);

  // Get call title and origin from activeCalls
  const activeCalls = useSelector(roomActor, state => state.context.activeCalls);
  const { callTitle, callOrigin } = useMemo(() => {
    const activeCall = activeCalls?.find(call => call.externalId === callId);
    return {
      callTitle: (activeCall as { title?: string })?.title,
      callOrigin: (activeCall as { callOrigin?: CallOrigin })?.callOrigin,
    };
  }, [activeCalls, callId]);
  const hasTitle = callTitle && callTitle.trim();

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
  const handleScreenShareClick = useCallback((identity: string): void => {
    setFocusedScreenShareIdentity(identity);
  }, []);

  // Handle toggling participants sidebar (closes chat if open)
  const handleToggleParticipantsSidebar = useCallback((): void => {
    setIsParticipantsSidebarOpen(prev => {
      // If opening participants sidebar, close chat
      if (!prev && isChatOpen) {
        onToggleThread();
      }
      return !prev;
    });
  }, [isChatOpen, onToggleThread]);

  // Close participants sidebar when chat opens
  useEffect(() => {
    if (isChatOpen && isParticipantsSidebarOpen) {
      setIsParticipantsSidebarOpen(false);
    }
  }, [isChatOpen, isParticipantsSidebarOpen]);

  // Determine if any sidebar is open (for layout adjustments)
  const isSidebarOpen = isChatOpen || isParticipantsSidebarOpen;

  return (
    <div
      className={cn(
        'h-screen bg-gradient-to-br from-gray-900 to-gray-950 flex flex-col overflow-hidden transition-all duration-300',
      )}
    >
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
        </div>
        <ConnectionStatusIndicators room={room} />
      </div>

      <CallStateTransition connectionState={connectionState} machineState={machineState}>
        {focusedScreenShare ? (
          // Screen share layout with sidebar
          <div
            className='flex-1 w-full pb-32 sm:pb-36 transition-all duration-300 overflow-hidden'
            style={{ paddingRight: isSidebarOpen ? 'min(500px, 100vw)' : '0' }}
          >
            <ScreenShareView
              focusedScreenShare={focusedScreenShare}
              screenSharingCount={screenSharingParticipants.length}
              participants={participants}
              onScreenShareClick={handleScreenShareClick}
              className='h-full'
              showSidebar={true}
              aiController={aiController}
              requestedAiController={requestedAiController}
            />
          </div>
        ) : (
          // Normal grid layout when no screen share
          <div
            className='flex-1 w-full pb-32 sm:pb-36 transition-all duration-300 overflow-hidden'
            style={{ paddingRight: isSidebarOpen ? 'min(500px, 100vw)' : '0' }}
          >
            <ParticipantGrid
              participants={participants}
              aiController={aiController}
              requestedAiController={requestedAiController}
            />
          </div>
        )}

        {/* Call Title */}
        {hasTitle && !isSidebarOpen && (
          <div className='absolute bottom-6 left-4 z-50'>
            <button
              type='button'
              className={cn(
                'text-md font-medium text-white/90 p-3 transition-transform duration-150 bg-transparent border-none',
                callOrigin === CallOrigin.CONVERSATION
                  ? 'cursor-pointer hover:text-white'
                  : 'cursor-default',
              )}
              onClick={() => {
                if (callOrigin === CallOrigin.CONVERSATION) {
                  onToggleThread();
                }
              }}
              onKeyDown={e => {
                if (
                  (e.key === 'Enter' || e.key === ' ') &&
                  callOrigin === CallOrigin.CONVERSATION
                ) {
                  onToggleThread();
                }
              }}
              data-track-category='CALLS'
              data-track-name='CALL_TITLE_TOGGLE_THREAD'
            >
              {callTitle}
            </button>
          </div>
        )}

        {/* Control Bar */}
        <div
          className='absolute bottom-3 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-1rem)] sm:w-auto max-w-[calc(100%-1rem)] transition-transform duration-300'
          style={{
            transform: isSidebarOpen
              ? 'translateX(calc(-50% - min(250px, 50vw)))'
              : 'translateX(-50%)',
          }}
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
            onToggleView={onMinimize}
            onToggleChat={onToggleThread}
            onToggleParticipantsSidebar={handleToggleParticipantsSidebar}
            onToggleAIAssistant={() => roomActor.send({ type: 'TOGGLE_AI_ASSISTANT' })}
            onRequestControl={onRequestControl}
            viewMode='full'
            requestedAiController={requestedAiController}
            pendingControlRequest={pendingControlRequest}
          />
        </div>
      </CallStateTransition>

      {/* Thread Panel - Sidebar */}
      {isChatOpen && channelId && conversationId && (
        <div className='fixed right-0 top-0 h-full w-full md:w-[500px] bg-background shadow-xl z-[60]'>
          <ThreadMessages
            channelId={channelId}
            conversationId={conversationId}
            onClose={onToggleThread}
          />
        </div>
      )}

      {/* Participants Sidebar */}
      {isParticipantsSidebarOpen && (
        <div className='fixed right-0 top-0 h-full w-full md:w-[500px] bg-background shadow-xl z-[60]'>
          <ParticipantsSidebar callId={callId} onClose={handleToggleParticipantsSidebar} />
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
    </div>
  );
}
