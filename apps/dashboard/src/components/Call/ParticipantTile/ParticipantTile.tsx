import { useMemo } from 'react';
import { ConnectionQuality, Track } from 'livekit-client';
import { useSelector } from '@xstate/react';
import { useParticipantNetworkQuality } from '../hooks/useParticipantNetworkQuality';
import { Hand, MicOff, Monitor, ImagePlus, Maximize2 } from 'lucide-react';
import { SignalBars } from '../components/SignalBars';
import type { ParticipantInfo } from '../../../machines/roomMachine';
import { roomActor } from '../../../machines/roomMachine';
import { ParticipantAvatar } from '../ParticipantAvatar/ParticipantAvatar';
import { getAvatarColors } from '../ParticipantAvatar/avatarColors';
import { cn } from '../../../utils/classNames';
import { useProfilePictureUrl } from '../../../hooks/useProfilePicture';
import { isScreenShareActive } from '../../../utils/livekitScreenShare';
import CompactActionsMenu from '../../ui/CompactActionsMenu';
import { SlashedBot } from '../CallPrivacyIndicator/CallPrivacyIndicator';

// Import LiveKit's built-in hooks that handle track management with observables
import { VideoTrack } from '@livekit/components-react';
import { useIsSpeaking } from '@livekit/components-react';

interface ParticipantTileProps {
  participant: ParticipantInfo;
  isScreenShare?: boolean | undefined;
  isFocused?: boolean | undefined;
  onClick?: (() => void) | undefined;
  onKeyDown?: ((e: React.KeyboardEvent) => void) | undefined;
  className?: string | undefined;
  avatarSize?: 'small' | 'medium' | 'large' | undefined;
  showScreenShareBadge?: boolean | undefined;
  compact?: boolean | undefined;
  aiController?: { id: string; name: string } | null;
  requestedAiController?: boolean;
  isHandRaised?: boolean | undefined;
  onToggleHandRaise?: (() => void) | undefined;
  /** Shows a hover "expand" button (top-right) that opens this tile full-screen. */
  onExpand?: (() => void) | undefined;
  /** Hide the participant name overlay (used by presentation mode's full-bleed tile) */
  hideNameLabel?: boolean | undefined;
  /** Drop the speaking/raised-hand glow ring (a full-screen coloured frame looks wrong) */
  hideSpeakingIndicator?: boolean | undefined;
}

export function ParticipantTile({
  participant,
  isScreenShare = false,
  isFocused = false,
  onClick,
  onKeyDown,
  className = '',
  avatarSize = 'large',
  showScreenShareBadge = false,
  compact = false,
  aiController,
  requestedAiController,
  isHandRaised = false,
  onToggleHandRaise,
  onExpand,
  hideNameLabel = false,
  hideSpeakingIndicator = false,
}: ParticipantTileProps): React.ReactElement {
  // Get track publications - these are observables that update automatically
  const cameraPublication = participant.participant?.getTrackPublication(Track.Source.Camera);
  const screenSharePublication = participant.participant?.getTrackPublication(
    Track.Source.ScreenShare,
  );

  // Determine if video should be shown
  const hasScreenShareVideo = isScreenShare && isScreenShareActive(participant.participant);
  const hasVideo =
    (participant.isCameraEnabled && cameraPublication?.isSubscribed) || hasScreenShareVideo;

  const isClickable = !!onClick;

  // Background blur state (web only) — surfaced as a toggle on the local tile.
  const isBackgroundBlurEnabled = useSelector(
    roomActor,
    state => state.context.isBackgroundBlurEnabled,
  );
  const showBlurToggle = participant.isLocal && !isScreenShare && !!hasVideo;
  // Bottom-right corner holds a control button on the local tile: the blur toggle
  // when the camera is on, otherwise the hand-raise button. Used to lift the
  // network-quality badge clear of whichever control owns the corner.
  const cornerHasControl =
    showBlurToggle || (participant.isLocal && !isScreenShare && !!onToggleHandRaise);

  // Check if this is the AI agent participant
  const isAIAgent = participant.identity.startsWith('agent-');
  const isControlled = isAIAgent && aiController;

  // Host detection + host name for the agent-tile menu: the backend stamps the
  // host's LiveKit identity as `createdBy` in room metadata (same source the toggle uses).
  const room = useSelector(roomActor, state => state.context.room);
  const hostIdentity = useMemo(() => {
    if (!room?.metadata) return null;
    try {
      return (JSON.parse(room.metadata) as { createdBy?: string }).createdBy ?? null;
    } catch {
      return null;
    }
  }, [room?.metadata]);
  const isHost = !!hostIdentity && hostIdentity === room?.localParticipant.identity;
  const hostName = useMemo(() => {
    if (!room || !hostIdentity) return null;
    if (hostIdentity === room.localParticipant.identity) return room.localParticipant.name ?? null;
    return room.remoteParticipants.get(hostIdentity)?.name ?? null;
  }, [room, hostIdentity]);

  // Use LiveKit's built-in hook for speaking detection - uses observables internally
  const isSpeaking = useIsSpeaking(participant.participant);

  // Track per-participant network quality
  const networkQuality = useParticipantNetworkQuality(participant.participant);

  // Determine avatar and background colors
  const colors = getAvatarColors(participant.identity);

  // Extract picture path from participant metadata
  let picturePath: string | null = null;
  try {
    const meta = participant.participant?.metadata;
    if (meta) {
      const parsed = JSON.parse(meta) as { picture?: string };
      picturePath = parsed.picture ?? null;
    }
  } catch {
    // ignore parse errors
  }

  const { url: pictureUrl } = useProfilePictureUrl(participant.identity, picturePath);

  // Create track references for LiveKit components only if publication exists.
  // Memoized so the trackRef keeps a stable identity across unrelated re-renders
  // (e.g. active-speaker / audio-level updates). Without this, VideoTrack
  // re-attaches the <video> element on every render, which flickers when a
  // processor (background blur) has swapped the underlying MediaStreamTrack.
  const videoTrackRef = useMemo(
    () =>
      hasScreenShareVideo && screenSharePublication && participant.participant
        ? {
            participant: participant.participant,
            source: Track.Source.ScreenShare,
            publication: screenSharePublication,
          }
        : cameraPublication && participant.participant
          ? {
              participant: participant.participant,
              source: Track.Source.Camera,
              publication: cameraPublication,
            }
          : undefined,
    [hasScreenShareVideo, screenSharePublication, cameraPublication, participant.participant],
  );

  const videoTrackStyle = useMemo(
    () => (participant.isLocal && !isScreenShare ? { transform: 'scaleX(-1)' } : undefined),
    [isScreenShare, participant.isLocal],
  );

  // Border styling based on state
  const getBorderClass = (): string => {
    if (isFocused && isScreenShare) {
      return 'border-blue-500 border-2';
    }
    if (isScreenShare) {
      return 'border-blue-400 border-2 cursor-pointer hover:border-blue-300';
    }
    // General "this tile is the current main/focused view" highlight — used e.g.
    // when a camera tile has been pinned to the main stage during screen share.
    if (isFocused) {
      return 'border-blue-400 border-2';
    }
    // Presentation mode fills the screen, so any state ring becomes a coloured
    // frame around the whole viewport — drop the border entirely there.
    if (hideSpeakingIndicator) {
      return 'border-0';
    }
    // Hand raised — amber glow to draw attention (a raised hand usually means
    // the person is waiting to speak, so it takes precedence over the speaking ring).
    if (isHandRaised) {
      return compact
        ? 'border-[2px] border-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.6)]'
        : 'border-amber-400 border-[3px] shadow-[0_0_15px_rgba(251,191,36,0.6)]';
    }
    if (isSpeaking && participant.isMicrophoneEnabled) {
      return compact
        ? 'border-[2px] border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.5)]'
        : 'border-green-500 border-[3px] shadow-[0_0_15px_rgba(34,197,94,0.5)]';
    }
    return compact ? 'border border-gray-700/30' : 'border-gray-700/30 border';
  };

  return (
    <div
      className={cn(
        'relative bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg overflow-hidden flex items-center justify-center transition-all duration-200',
        compact ? 'shadow-lg' : 'shadow-lg group',
        isClickable && !isScreenShare && 'cursor-pointer hover:brightness-110',
        getBorderClass(),
        className,
      )}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
      data-track-category='CALLS'
      data-track-name='Participant_Tile'
      data-track-metadata={JSON.stringify({
        participantIdentity: participant.identity,
        participantName: participant.name,
      })}
    >
      {/* Expand-to-fullscreen button — top-right corner, hover-revealed (mirrors the
          screen-share tile's expand affordance). Not shown for screen-share tiles
          (ScreenShareView already has its own fullscreen entry point) or compact
          tiles (mini call view), and never overlaps the AI agent's actions menu
          since that only renders on agent tiles. */}
      {onExpand && !isScreenShare && !compact && !isAIAgent && (
        <button
          onClick={e => {
            e.stopPropagation();
            onExpand();
          }}
          title='Expand'
          aria-label={`Expand ${participant.isLocal ? 'your' : `${participant.name}'s`} video`}
          data-track-category='CALLS'
          data-track-name='Expand_Participant_Tile'
          data-track-metadata={JSON.stringify({ participantIdentity: participant.identity })}
          className={cn(
            'absolute top-1 right-1 sm:top-2 sm:right-2 z-20 flex items-center justify-center',
            'rounded-md p-1.5 sm:p-2 bg-black/50 text-white/90 shadow-md transition-all duration-200',
            'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/70 hover:text-white',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
          )}
        >
          <Maximize2 className='h-3.5 w-3.5 sm:h-4 sm:w-4' />
        </button>
      )}

      {/* Agent-tile actions. Host: "Remove from call" opens the transcription popover
          (one-click stop/start there) — the reversible soft kill-switch, not a hard
          removal. Non-host: a disabled note pointing them to the host. */}
      {isAIAgent && !compact && (
        <div
          data-theme='midnight'
          className='absolute top-2 right-2 z-20 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100'
        >
          <CompactActionsMenu
            triggerClassName='p-1.5 h-7 w-7 rounded-md border-0 bg-background/70 text-foreground hover:bg-background'
            forceDarkTheme
            items={[
              isHost
                ? {
                    onSelect: () => roomActor.send({ type: 'SET_PRIVACY_POPOVER', open: true }),
                    testId: 'remove-agent-menu-item',
                    customContent: (
                      <div className='flex items-start gap-2.5 px-3 py-2'>
                        <SlashedBot className='mt-0.5 h-4 w-4 text-destructive' />
                        <div className='min-w-0'>
                          <div className='text-sm font-semibold text-destructive'>
                            Remove from call
                          </div>
                          <div className='mt-0.5 text-xs leading-snug text-muted-foreground'>
                            Stops transcription for everyone. You can add the agent back later.
                          </div>
                        </div>
                      </div>
                    ),
                  }
                : {
                    disabled: true,
                    onSelect: () => undefined,
                    testId: 'remove-agent-menu-item-disabled',
                    customContent: (
                      <div className='flex max-w-[16rem] items-start gap-2.5 px-3 py-2'>
                        <SlashedBot className='mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground' />
                        <div className='min-w-0 text-xs leading-snug text-muted-foreground'>
                          Please ask{' '}
                          <span className='font-semibold text-foreground'>
                            {hostName ?? 'the host'}
                          </span>{' '}
                          (host) to stop transcribing the call.
                        </div>
                      </div>
                    ),
                  },
            ]}
          />
        </div>
      )}

      {/* Video Track - Using LiveKit's VideoTrack component */}
      {(hasVideo || isScreenShare) && videoTrackRef ? (
        <VideoTrack
          trackRef={videoTrackRef}
          className={cn(
            'w-full h-full',
            // Camera tiles: object-cover so the tile is always fully filled with
            // no empty letterbox bars, matching Discord/Google Meet's grid tiles
            // (they crop-to-fill from center rather than pillarboxing). Screen
            // shares stay object-contain — cropping a shared screen would hide content.
            isScreenShare ? 'object-contain bg-black' : 'object-cover',
          )}
          style={videoTrackStyle}
        />
      ) : (
        <div
          className='flex items-center justify-center w-full h-full'
          style={{ backgroundColor: colors.background }}
        >
          {isAIAgent ? (
            <img
              src='/images/xyne_logo.png'
              alt='Xyne Automatic'
              className={cn(
                'rounded-full object-cover visual-regression-hide',
                avatarSize === 'small'
                  ? 'w-8 h-8'
                  : avatarSize === 'medium'
                    ? 'w-12 h-12'
                    : 'w-16 h-16',
              )}
            />
          ) : (
            <ParticipantAvatar
              name={participant.name || 'Unknown'}
              size={avatarSize}
              backgroundColor={colors.avatar}
              pictureUrl={pictureUrl}
            />
          )}
        </div>
      )}

      {/* Screen Share Indicator Badge */}
      {showScreenShareBadge && (
        <div
          className={cn(
            'absolute bg-blue-500 rounded-full shadow-lg z-10',
            compact ? 'top-0.5 left-0.5 p-0.5' : 'top-1 left-1 sm:top-2 sm:left-2 p-1 sm:p-1.5',
          )}
        >
          <Monitor
            className={cn('text-white', compact ? 'w-2.5 h-2.5' : 'w-2.5 h-2.5 sm:w-3 sm:h-3')}
          />
        </div>
      )}

      {/* No per-tile <AudioTrack> here: `RoomAudioRenderer` is mounted once,
          globally, in GlobalCallOverlay.tsx and already plays every remote
          participant's audio exactly once for the whole call — regardless of
          how many ParticipantTile instances visually represent them (grid,
          spotlight main stage, spotlight sidebar, fullscreen modal, mini
          view, etc). Rendering a second <AudioTrack> per tile here used to
          double (or triple, whenever a participant appeared in more than one
          tile at once) their audio. */}

      {/* Participant Info Overlay */}
      {!hideNameLabel && (
        <div
          className={cn(
            'absolute text-white font-medium drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] visual-regression-hide',
            compact
              ? 'bottom-0.5 left-0.5 text-[9px]'
              : 'bottom-1 left-1 sm:bottom-2 sm:left-2 text-[10px] sm:text-xs max-w-[calc(100%-0.5rem)] truncate',
          )}
        >
          {participant.isLocal ? 'You' : isAIAgent ? 'Xyne Automatic' : participant.name}
        </div>
      )}

      {/* Background Blur Toggle - local tile only, when camera is on */}
      {showBlurToggle && (
        <button
          onClick={e => {
            e.stopPropagation();
            roomActor.send({ type: 'TOGGLE_BACKGROUND_BLUR' });
          }}
          title={isBackgroundBlurEnabled ? 'Turn off background blur' : 'Blur background'}
          aria-label={isBackgroundBlurEnabled ? 'Turn off background blur' : 'Blur background'}
          data-track-category='CALLS'
          data-track-name='TOGGLE_BACKGROUND_BLUR_TILE'
          data-track-metadata={JSON.stringify({ enabled: !isBackgroundBlurEnabled })}
          className={cn(
            'absolute z-10 flex items-center justify-center rounded-full shadow-md transition-colors',
            compact
              ? 'bottom-1 right-1 p-1'
              : 'bottom-1 right-1 p-1.5 sm:bottom-2 sm:right-2 sm:p-2',
            isBackgroundBlurEnabled
              ? 'bg-blue-600 text-white hover:bg-blue-500'
              : 'bg-black/50 text-white hover:bg-black/70',
          )}
        >
          <ImagePlus className={cn(compact ? 'w-3 h-3' : 'w-4 h-4 sm:w-5 sm:h-5')} />
        </button>
      )}

      {/* Raised-hand indicator — prominent, shown on EVERY participant's tile so
          all members clearly see who has their hand up (driven by data channel). */}
      {isHandRaised && (
        <div
          className={cn(
            'absolute left-0 top-0 z-20 flex items-center gap-1 rounded-br-lg bg-amber-500 font-semibold text-white shadow-md',
            compact ? 'px-1 py-0.5 text-[9px]' : 'px-2 py-1 text-[10px] sm:text-xs',
          )}
        >
          <Hand
            className={cn('animate-bounce', compact ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5 sm:h-4 sm:w-4')}
          />
          {!compact && <span className='hidden sm:inline'>Raised</span>}
        </div>
      )}

      {/* Hand Raise Toggle - local tile only, always available (no camera needed).
          Owns the bottom-right corner; when the camera is on the background-blur
          button takes the corner, so step left to sit beside it. */}
      {participant.isLocal && !isScreenShare && onToggleHandRaise && (
        <button
          onClick={e => {
            e.stopPropagation();
            onToggleHandRaise();
          }}
          title={isHandRaised ? 'Lower hand' : 'Raise hand'}
          aria-label={isHandRaised ? 'Lower hand' : 'Raise hand'}
          data-track-category='CALLS'
          data-track-name='TOGGLE_HAND_RAISE_TILE'
          data-track-metadata={JSON.stringify({ raised: !isHandRaised })}
          className={cn(
            'absolute z-10 flex items-center justify-center rounded-full shadow-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/60',
            compact ? 'bottom-1 p-1' : 'bottom-1 p-1.5 sm:bottom-2 sm:p-2',
            // Camera on → blur button holds the corner, so offset left; else take the corner.
            hasVideo
              ? compact
                ? 'right-[1.625rem]'
                : 'right-10 sm:right-12'
              : compact
                ? 'right-1'
                : 'right-1 sm:right-2',
            isHandRaised
              ? 'bg-amber-500 text-white hover:bg-amber-400'
              : 'bg-black/55 text-white hover:bg-black/75',
          )}
        >
          <Hand className={cn(compact ? 'h-3 w-3' : 'h-4 w-4 sm:h-5 sm:w-5')} />
        </button>
      )}

      {/* AI Controller Badge - Show "Acquired by [UserName]" when AI is controlled */}
      {isControlled && (
        <div
          className={cn(
            'absolute bg-purple-600/90 backdrop-blur-sm text-white font-medium rounded px-2 py-1 shadow-lg',
            compact
              ? 'top-0.5 right-0.5 text-[8px]'
              : 'top-1 right-1 sm:top-2 sm:right-2 text-[9px] sm:text-[10px]',
          )}
        >
          {requestedAiController
            ? `Requested control from ${aiController?.name}`
            : `Acquired by ${aiController?.name}`}
        </div>
      )}

      {/* Network quality indicator.
          Bottom-right corner is shared with the local tile's control button (blur
          when camera on, hand-raise when off). When a control holds the corner,
          lift the badge above it so the signal indicator stays visible on
          poor/lost connections. */}
      {(networkQuality === ConnectionQuality.Poor || networkQuality === ConnectionQuality.Lost) && (
        <div
          className={cn(
            'absolute rounded-full visual-regression-hide',
            compact
              ? cornerHasControl
                ? 'bottom-6 right-0.5 p-0.5'
                : 'bottom-0.5 right-0.5 p-0.5'
              : cornerHasControl
                ? 'bottom-10 right-1 sm:bottom-12 sm:right-2 p-1'
                : 'bottom-1 right-1 sm:bottom-2 sm:right-2 p-1',
            networkQuality === ConnectionQuality.Lost
              ? 'bg-black/40 text-red-400'
              : 'bg-black/40 text-amber-400',
          )}
          title={networkQuality === ConnectionQuality.Lost ? 'Connection lost' : 'Poor connection'}
        >
          <SignalBars
            activeColor={networkQuality === ConnectionQuality.Lost ? '#f87171' : '#fbbf24'}
            className={cn(compact ? 'w-2.5 h-2.5' : 'w-3.5 h-3.5')}
          />
        </div>
      )}

      {/* Mute indicator */}
      {!participant.isMicrophoneEnabled && (
        <div
          className={cn(
            'absolute bg-red-500 rounded-full',
            compact
              ? 'top-0.5 right-0.5 p-0.5 shadow-sm'
              : 'top-1 right-1 sm:top-2 sm:right-2 p-1 sm:p-1.5 shadow-lg',
          )}
        >
          <MicOff className={cn('text-white', compact ? 'w-2.5 h-2.5' : 'w-2 h-2 sm:w-3 sm:h-3')} />
        </div>
      )}
    </div>
  );
}
