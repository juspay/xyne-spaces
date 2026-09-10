import { useCallback, useMemo, useRef, useState } from 'react';
import { Track } from 'livekit-client';
import { VideoTrack } from '@livekit/components-react';
import { Maximize2, Minimize2, MonitorPlay } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { ParticipantTile } from '../ParticipantTile/ParticipantTile';
import { ScreenShareFullscreenModal } from '../ScreenShareFullscreenModal';
import { VideoTileFullscreenModal } from '../VideoTileFullscreenModal';
import { DrawingCanvas, DrawingToolbar } from '../DrawingCanvas';
import type { DrawingCanvasHandle } from '../DrawingCanvas';
import { useDrawStore } from '../../../hooks/useDrawStore';
import { isScreenShareActive } from '../../../utils/livekitScreenShare';
import type { ParticipantInfo } from '../../../machines/roomMachine';

export type SpotlightMode = 'camera' | 'screen';

interface SpotlightViewProps {
  /** Every participant in the call (including whoever is on the main stage). */
  participants: ParticipantInfo[];
  /** Identity of whichever participant currently occupies the main stage. */
  mainIdentity: string;
  /** Whether the main stage shows that participant's screen share or camera. */
  mainMode: SpotlightMode;
  /**
   * Called whenever the user swaps the main stage — by clicking a sidebar
   * tile, or the "back to screen share" pill. The caller owns the actual
   * selection state (and any auto-focus/cleanup effects around it).
   */
  onSelect: (identity: string, mode: SpotlightMode) => void;
  /**
   * Renders a "back" button that exits the spotlight entirely (returns to a
   * plain grid) instead of swapping. Omit this when the main stage must
   * always show something (e.g. while a screen share is active).
   */
  onExit?: () => void;
  showSidebar?: boolean;
  showDrawingTools?: boolean;
  allowFullScreen?: boolean;
  compact?: boolean;
  className?: string;
  aiController?: { id: string; name: string } | null;
  requestedAiController?: boolean;
  raisedHands?: string[];
  onToggleHandRaise?: (() => void) | undefined;
}

/**
 * Single shared "spotlight" UI: one big main tile (camera or screen share) +
 * a scrollable sidebar of every other participant, with click-to-swap and a
 * fullscreen entry point. Used by BOTH `ScreenShareView` (screen-share mode,
 * always has a main) and `ParticipantGrid`'s tile-expand ("spotlight") mode —
 * those two were previously separate, near-identical implementations.
 *
 * Each participant can have up to two "feeds": camera and (if sharing)
 * screen. The sidebar shows, for every participant, whichever of their feeds
 * is NOT currently on the main stage — including the main participant
 * themselves when they have a second feed (e.g. the presenter's camera shows
 * in the sidebar while their screen is the main stage, and vice versa).
 */
export function SpotlightView({
  participants,
  mainIdentity,
  mainMode,
  onSelect,
  onExit,
  showSidebar = true,
  showDrawingTools = false,
  allowFullScreen = true,
  compact = false,
  className,
  aiController = null,
  requestedAiController = false,
  raisedHands = [],
  onToggleHandRaise,
}: SpotlightViewProps): React.ReactElement | null {
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const drawingCanvasRef = useRef<DrawingCanvasHandle>(null);
  const isDrawingEnabled = useDrawStore(s => s.isDrawingEnabled);

  const mainParticipant = useMemo(
    () => participants.find(p => p.identity === mainIdentity),
    [participants, mainIdentity],
  );

  const isSharing = useCallback((p: ParticipantInfo): boolean => {
    return p.participant ? isScreenShareActive(p.participant) : !!p.isScreenShareEnabled;
  }, []);

  const mainIsSharing = !!mainParticipant && isSharing(mainParticipant);

  // How many participants are currently sharing their screen — shown as a
  // "(N sharing)" suffix on the main label when there's more than one, so
  // people know there are other screen shares to swap to via the sidebar.
  const sharingCount = useMemo(
    () => participants.filter(isSharing).length,
    [participants, isSharing],
  );

  const screenShareTrackRef = useMemo(() => {
    if (mainMode !== 'screen' || !mainParticipant?.participant) return undefined;
    const publication = mainParticipant.participant.getTrackPublication(Track.Source.ScreenShare);
    if (!isScreenShareActive(mainParticipant.participant) || !publication) return undefined;
    return {
      participant: mainParticipant.participant,
      source: Track.Source.ScreenShare,
      publication,
    };
  }, [mainMode, mainParticipant]);

  // Sidebar: everyone's "other" feed relative to whatever's on the main stage.
  const sidebarEntries = useMemo(() => {
    return participants.reduce<Array<{ participant: ParticipantInfo; mode: SpotlightMode }>>(
      (entries, p) => {
        const sharing = isSharing(p);
        if (p.identity === mainIdentity) {
          // Only show the main participant again if they have a SECOND feed
          // the main stage isn't currently using.
          if (mainMode === 'camera' && sharing) {
            entries.push({ participant: p, mode: 'screen' });
          } else if (mainMode === 'screen') {
            entries.push({ participant: p, mode: 'camera' });
          }
          return entries;
        }
        entries.push({ participant: p, mode: sharing ? 'screen' : 'camera' });
        return entries;
      },
      [],
    );
  }, [participants, mainIdentity, mainMode, isSharing]);

  const handleExpandClick = useCallback((): void => {
    if (mainParticipant) setIsFullscreenOpen(true);
  }, [mainParticipant]);

  const handleFullscreenClose = useCallback((): void => {
    setIsFullscreenOpen(false);
  }, []);

  if (!mainParticipant) return null;

  return (
    <div className={cn('h-full w-full flex overflow-hidden', className)}>
      {/* Main stage */}
      <div className={cn('flex-1 p-2 sm:p-4 overflow-hidden flex flex-col', compact && 'p-0')}>
        <div className='bg-gray-800 rounded-lg overflow-hidden flex items-center justify-center relative flex-1 min-h-0'>
          {mainMode === 'screen' && screenShareTrackRef ? (
            <VideoTrack trackRef={screenShareTrackRef} className='w-full h-full object-contain' />
          ) : (
            <ParticipantTile
              participant={mainParticipant}
              className='h-full w-full'
              avatarSize='large'
              aiController={aiController}
              requestedAiController={requestedAiController}
              isHandRaised={raisedHands.includes(mainParticipant.identity)}
              onToggleHandRaise={onToggleHandRaise}
            />
          )}

          {mainMode === 'screen' && screenShareTrackRef && showDrawingTools && (
            <DrawingCanvas ref={drawingCanvasRef} />
          )}
          {mainMode === 'screen' && screenShareTrackRef && showDrawingTools && isDrawingEnabled && (
            <DrawingToolbar />
          )}

          {/* Label */}
          <div
            className={cn(
              'absolute bg-black/70 backdrop-blur-sm rounded-lg text-white font-medium border border-white/10',
              compact
                ? 'top-2 left-2 px-2 py-1 text-[10px]'
                : 'top-2 left-2 sm:top-4 sm:left-4 px-2 py-1 sm:px-4 sm:py-2 text-xs sm:text-sm',
            )}
          >
            {mainMode === 'screen'
              ? `${mainParticipant.name}'s Screen`
              : mainParticipant.isLocal
                ? 'You'
                : mainParticipant.name}
            {mainMode === 'screen' && sharingCount > 1 && (
              <span className={cn(compact ? 'ml-1' : 'ml-2', 'text-muted')}>
                ({sharingCount} {compact ? '' : 'sharing'})
              </span>
            )}
          </div>

          {/* Top-right control cluster: "minimize" (exit spotlight / back to
              screen share) + "maximize" (true fullscreen) grouped together as
              a pair, so they read as a single set of view-size controls. */}
          <div className='absolute top-2 right-2 sm:top-4 sm:right-4 z-20 flex items-center gap-2'>
            {onExit && (
              <button
                onClick={onExit}
                className={cn(
                  'flex items-center justify-center w-9 h-9 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-sm',
                  'border border-white/20 text-white/90 hover:text-white transition-all duration-200',
                  'focus:outline-none focus:ring-2 focus:ring-white/30',
                )}
                aria-label='Back to grid view'
                data-track-category='CALLS'
                data-track-name='Exit_Spotlight_View'
              >
                <Minimize2 className='w-4 h-4' />
              </button>
            )}

            {/* Back-to-screen-share — shown when the main participant is
                sharing but their CAMERA is on stage instead. */}
            {mainMode === 'camera' && mainIsSharing && (
              <button
                onClick={() => onSelect(mainParticipant.identity, 'screen')}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border border-white/10',
                  'bg-black/70 backdrop-blur-sm text-white font-medium hover:bg-black/80 transition-all duration-200',
                  'focus:outline-none focus:ring-2 focus:ring-white/30',
                  compact
                    ? 'px-2 py-1 text-[10px]'
                    : 'px-2 py-1 sm:px-4 sm:py-2 text-xs sm:text-sm',
                )}
                aria-label='Show screen share'
                data-track-category='CALLS'
                data-track-name='Restore_ScreenShare_Main'
              >
                <MonitorPlay className={cn(compact ? 'w-3 h-3' : 'w-3.5 h-3.5 sm:w-4 sm:h-4')} />
                {!compact && <span>Back to screen share</span>}
              </button>
            )}

            {/* Fullscreen expand */}
            {allowFullScreen && (
              <button
                onClick={handleExpandClick}
                className={cn(
                  'flex items-center justify-center',
                  'bg-black/50 hover:bg-black/70 backdrop-blur-sm border border-white/20 rounded-full',
                  'text-white/90 hover:text-white transition-all duration-200',
                  'focus:outline-none focus:ring-2 focus:ring-white/30',
                  compact ? 'w-8 h-8' : 'w-9 h-9',
                )}
                aria-label={
                  mainMode === 'screen'
                    ? `View ${mainParticipant.name}'s screen in fullscreen`
                    : `View ${mainParticipant.name}'s video in fullscreen`
                }
                data-track-category='CALLS'
                data-track-name='Open_Spotlight_Fullscreen'
                data-track-metadata={JSON.stringify({
                  participantIdentity: mainParticipant.identity,
                })}
              >
                <Maximize2 className={cn(compact ? 'w-4 h-4' : 'w-4 h-4')} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sidebar */}
      {showSidebar && (
        <aside
          className={cn(
            'hidden sm:flex flex-col gap-2 sm:gap-3 p-2 sm:p-4 overflow-y-auto bg-gray-950/50 backdrop-blur-sm',
            compact ? 'w-20' : 'w-56 md:w-64 lg:w-80',
          )}
        >
          {sidebarEntries.map(({ participant, mode }) => (
            <ParticipantTile
              key={participant.identity}
              participant={participant}
              isScreenShare={mode === 'screen'}
              isFocused={participant.identity === mainIdentity}
              isHandRaised={raisedHands.includes(participant.identity)}
              onToggleHandRaise={onToggleHandRaise}
              onClick={() => onSelect(participant.identity, mode)}
              onKeyDown={(e): void => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(participant.identity, mode);
                }
              }}
              className={cn(
                'aspect-video flex-shrink-0',
                compact ? 'min-h-[60px]' : 'min-h-[80px] sm:min-h-[120px]',
              )}
              avatarSize={compact ? 'small' : 'medium'}
              showScreenShareBadge={isSharing(participant)}
              compact={compact}
              aiController={aiController}
              requestedAiController={requestedAiController}
              data-track-category='CALLS'
              data-track-name='Select_Spotlight_Sidebar_Tile'
              data-track-metadata={JSON.stringify({ participantIdentity: participant.identity })}
            />
          ))}
        </aside>
      )}

      {/* Fullscreen modal — screen share track, or a plain participant tile. */}
      {mainMode === 'screen' ? (
        <ScreenShareFullscreenModal
          trackRef={screenShareTrackRef}
          isOpen={isFullscreenOpen}
          onClose={handleFullscreenClose}
          participantName={mainParticipant.name || 'Unknown'}
        />
      ) : (
        <VideoTileFullscreenModal
          participant={isFullscreenOpen ? mainParticipant : null}
          isOpen={isFullscreenOpen}
          onClose={handleFullscreenClose}
          aiController={aiController}
          requestedAiController={requestedAiController}
          isHandRaised={raisedHands.includes(mainParticipant.identity)}
          onToggleHandRaise={onToggleHandRaise}
        />
      )}
    </div>
  );
}
