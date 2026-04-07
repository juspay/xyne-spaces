import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Track } from 'livekit-client';
import { useSelector } from '@xstate/react';
import { Maximize2 } from 'lucide-react';
import { roomActor } from '../../../machines/roomMachine';
import type { ParticipantInfo } from '../../../machines/roomMachine';
import { cn } from '../../../utils/classNames';
import { ParticipantTile } from '../ParticipantTile/ParticipantTile';
import { VideoTrack } from '@livekit/components-react';
import { logger, Event } from '../../../utils/logger';
import { ScreenShareFullscreenModal } from '../ScreenShareFullscreenModal';
import { DrawingCanvas, DrawingToolbar } from '../DrawingCanvas';
import type { DrawingCanvasHandle } from '../DrawingCanvas';
import { useDrawStore } from '../../../hooks/useDrawStore';

interface ScreenShareViewProps {
  focusedScreenShare: ParticipantInfo;
  screenSharingCount: number;
  participants: ParticipantInfo[];
  onScreenShareClick: (identity: string) => void;
  className?: string | undefined;
  compact?: boolean | undefined;
  showSidebar?: boolean | undefined;
  showDrawingTools?: boolean | undefined;
  aiController?: { id: string; name: string } | null;
  requestedAiController?: boolean;
}

export function ScreenShareView({
  focusedScreenShare,
  screenSharingCount,
  participants,
  onScreenShareClick,
  className = '',
  compact = false,
  showSidebar = true,
  showDrawingTools = false,
  aiController,
  requestedAiController,
}: ScreenShareViewProps): React.ReactElement {
  const callId = useSelector(roomActor, state => state.context.callId);

  // Fullscreen modal state
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);

  // Drawing canvas ref (for imperative clearAll)
  const drawingCanvasRef = useRef<DrawingCanvasHandle>(null);
  const isDrawingEnabled = useDrawStore(s => s.isDrawingEnabled);

  // Create track reference for the focused screen share
  const screenSharePublication = focusedScreenShare.participant?.getTrackPublication(
    Track.Source.ScreenShare,
  );

  const screenShareTrackRef = useMemo(
    () =>
      screenSharePublication && focusedScreenShare.participant
        ? {
            participant: focusedScreenShare.participant,
            source: Track.Source.ScreenShare,
            publication: screenSharePublication,
          }
        : undefined,
    [screenSharePublication, focusedScreenShare.participant],
  );

  // Handle screen share video click to open fullscreen
  const handleScreenShareClick = useCallback((): void => {
    if (screenShareTrackRef) {
      setIsFullscreenOpen(true);
    }
  }, [screenShareTrackRef]);

  // Handle fullscreen modal close
  const handleFullscreenClose = useCallback((): void => {
    setIsFullscreenOpen(false);
  }, []);

  // Log screen share rendering diagnostics for debugging invisible screen shares
  useEffect(() => {
    const publication = screenSharePublication;
    const track = publication?.track;

    logger.info(Event.LIVEKIT_SCREEN_SHARE_RENDERED, {
      callId,
      participantIdentity: focusedScreenShare.identity,
      hasPublication: !!publication,
      hasTrack: !!track,
      isSubscribed: publication?.isSubscribed ?? false,
      isMuted: publication?.isMuted ?? false,
      trackSid: publication?.trackSid ?? null,
      hasTrackRef: !!screenShareTrackRef,
      trackDimensions: track?.mediaStreamTrack
        ? {
            width: track.mediaStreamTrack.getSettings().width,
            height: track.mediaStreamTrack.getSettings().height,
          }
        : null,
      mediaStreamTrackState: track?.mediaStreamTrack?.readyState ?? null,
    });
  }, [
    focusedScreenShare.identity,
    screenSharePublication,
    screenSharePublication?.track,
    screenSharePublication?.isSubscribed,
    screenSharePublication?.isMuted,
    screenShareTrackRef,
  ]);

  // Sort participants: active speaker first, screen sharers next, then others
  const sortedParticipants = useMemo(() => {
    return [...participants].sort((a, b) => {
      // Get speaking state directly from participant (handle native mode where participant is undefined)
      const aIsSpeaking = a.participant?.isSpeaking && a.isMicrophoneEnabled;
      const bIsSpeaking = b.participant?.isSpeaking && b.isMicrophoneEnabled;

      // In native mode, use isScreenShareEnabled flag; in web mode, check actual publication
      const aIsSharing = a.participant
        ? a.participant.getTrackPublication(Track.Source.ScreenShare)?.isSubscribed
        : a.isScreenShareEnabled;
      const bIsSharing = b.participant
        ? b.participant.getTrackPublication(Track.Source.ScreenShare)?.isSubscribed
        : b.isScreenShareEnabled;

      // Active speaker comes first
      if (aIsSpeaking && !bIsSpeaking) return -1;
      if (!aIsSpeaking && bIsSpeaking) return 1;

      // Screen sharers come next
      if (aIsSharing && !bIsSharing) return -1;
      if (!aIsSharing && bIsSharing) return 1;

      return 0;
    });
  }, [participants]);

  return (
    <div className={cn('h-full w-full flex overflow-hidden', className)}>
      {/* Main Screen Share Area */}
      <div className={cn('flex-1 p-2 sm:p-4 overflow-hidden flex flex-col', compact && 'p-0')}>
        <div
          className={cn(
            'bg-gray-800 rounded-lg overflow-hidden flex items-center justify-center relative flex-1 min-h-0',
          )}
        >
          {/* Screen share video using LiveKit's VideoTrack component */}
          {screenShareTrackRef && (
            <VideoTrack trackRef={screenShareTrackRef} className='w-full h-full object-contain' />
          )}

          {/* Drawing overlay — rendered on top of the video, below UI labels */}
          {screenShareTrackRef && showDrawingTools && <DrawingCanvas ref={drawingCanvasRef} />}

          {/* Drawing toolbar — only shown when drawing mode is active */}
          {screenShareTrackRef && showDrawingTools && isDrawingEnabled && <DrawingToolbar />}

          {/* Screen Share Label */}
          <div
            className={cn(
              'absolute bg-black/70 backdrop-blur-sm rounded-lg text-white font-medium border border-white/10',
              compact
                ? 'top-2 left-2 px-2 py-1 text-[10px]'
                : 'top-2 left-2 sm:top-4 sm:left-4 px-2 py-1 sm:px-4 sm:py-2 text-xs sm:text-sm',
            )}
          >
            {focusedScreenShare.name}&apos;s Screen
            {screenSharingCount > 1 && (
              <span className={cn(compact ? 'ml-1' : 'ml-2', 'text-muted')}>
                ({screenSharingCount} {compact ? '' : 'sharing'})
              </span>
            )}
          </div>

          {/* Fullscreen Expand Button - Bottom Right */}
          {screenShareTrackRef && (
            <button
              onClick={handleScreenShareClick}
              className={cn(
                'absolute z-10 flex items-center justify-center',
                'bg-black/50 hover:bg-black/70 backdrop-blur-sm',
                'border border-white/20 rounded-lg',
                'text-white/90 hover:text-white',
                'transition-all duration-200',
                'focus:outline-none focus:ring-2 focus:ring-white/30',
                compact
                  ? 'bottom-2 right-2 w-8 h-8'
                  : 'bottom-2 right-2 sm:bottom-4 sm:right-4 w-10 h-10',
              )}
              aria-label={`View ${focusedScreenShare.name}'s screen in fullscreen`}
              data-track-category='CALLS'
              data-track-name='Open_ScreenShare_Fullscreen'
              data-track-metadata={JSON.stringify({
                participantIdentity: focusedScreenShare.identity,
              })}
            >
              <Maximize2 className={cn(compact ? 'w-4 h-4' : 'w-5 h-5')} />
            </button>
          )}
        </div>
      </div>

      {/* Sidebar with Participants */}
      {showSidebar && (
        <aside
          className={cn(
            'hidden sm:flex flex-col gap-2 sm:gap-3 p-2 sm:p-4 overflow-y-auto bg-gray-950/50 backdrop-blur-sm',
            compact ? 'w-20' : 'w-56 md:w-64 lg:w-80',
          )}
        >
          {sortedParticipants.map(participant => {
            // In native mode, use isScreenShareEnabled; in web mode, check actual publication
            const isSharing = participant.participant
              ? participant.participant.getTrackPublication(Track.Source.ScreenShare)?.isSubscribed
              : participant.isScreenShareEnabled;
            const isFocusedShare =
              isSharing && focusedScreenShare.identity === participant.identity;

            // If this participant is the focused screen share, show their camera in sidebar
            // (not their screen share, since that's already shown in main view)
            // Otherwise, if they're sharing, show their screen share as a thumbnail
            const shouldShowScreenShareInSidebar = isSharing && !isFocusedShare;

            return (
              <ParticipantTile
                key={participant.identity}
                participant={participant}
                isScreenShare={shouldShowScreenShareInSidebar}
                isFocused={!!isFocusedShare}
                onClick={
                  isSharing
                    ? (): void => {
                        onScreenShareClick(participant.identity);
                      }
                    : undefined
                }
                onKeyDown={
                  isSharing
                    ? (e): void => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onScreenShareClick(participant.identity);
                        }
                      }
                    : undefined
                }
                className={cn(
                  'aspect-video flex-shrink-0',
                  compact ? 'min-h-[60px]' : 'min-h-[80px] sm:min-h-[120px]',
                )}
                avatarSize={compact ? 'small' : 'medium'}
                showScreenShareBadge={!!isSharing}
                compact={compact}
                aiController={aiController ?? null}
                requestedAiController={requestedAiController ?? false}
                data-track-category='CALLS'
                data-track-name='Select_Screen_Share'
                data-track-metadata={JSON.stringify({ participantIdentity: participant.identity })}
              />
            );
          })}
        </aside>
      )}

      {/* Fullscreen Modal */}
      <ScreenShareFullscreenModal
        trackRef={screenShareTrackRef}
        isOpen={isFullscreenOpen}
        onClose={handleFullscreenClose}
        participantName={focusedScreenShare.name || 'Unknown'}
      />
    </div>
  );
}
