import { ConnectionQuality, Track } from 'livekit-client';
import { useParticipantNetworkQuality } from '../hooks/useParticipantNetworkQuality';
import { Hand, MicOff, Monitor } from 'lucide-react';
import { SignalBars } from '../components/SignalBars';
import type { ParticipantInfo } from '../../../machines/roomMachine';
import { ParticipantAvatar } from '../ParticipantAvatar/ParticipantAvatar';
import { getAvatarColors } from '../ParticipantAvatar/avatarColors';
import { cn } from '../../../utils/classNames';
import { useProfilePictureUrl } from '../../../hooks/useProfilePicture';

// Import LiveKit's built-in hooks that handle track management with observables
import { VideoTrack } from '@livekit/components-react';
import { AudioTrack } from '@livekit/components-react';
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
}: ParticipantTileProps): React.ReactElement {
  // Get track publications - these are observables that update automatically
  const cameraPublication = participant.participant?.getTrackPublication(Track.Source.Camera);
  const screenSharePublication = participant.participant?.getTrackPublication(
    Track.Source.ScreenShare,
  );
  const microphonePublication = participant.participant?.getTrackPublication(
    Track.Source.Microphone,
  );

  // Determine if video should be shown
  const hasVideo =
    (participant.isCameraEnabled && cameraPublication?.isSubscribed) ||
    (isScreenShare && screenSharePublication?.isSubscribed);

  const isClickable = isScreenShare && onClick;

  // Check if this is the AI agent participant
  const isAIAgent = participant.identity.startsWith('agent-');
  const isControlled = isAIAgent && aiController;

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

  // Create track references for LiveKit components only if publication exists
  const videoTrackRef =
    isScreenShare && screenSharePublication && participant.participant
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
        : undefined;

  const audioTrackRef =
    microphonePublication && participant.participant
      ? {
          participant: participant.participant,
          source: Track.Source.Microphone,
          publication: microphonePublication,
        }
      : undefined;

  // Border styling based on state
  const getBorderClass = (): string => {
    if (isFocused && isScreenShare) {
      return 'border-blue-500 border-2';
    }
    if (isScreenShare) {
      return 'border-blue-400 border-2 cursor-pointer hover:border-blue-300';
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
      {/* Video Track - Using LiveKit's VideoTrack component */}
      {(hasVideo || isScreenShare) && videoTrackRef ? (
        <VideoTrack
          trackRef={videoTrackRef}
          className={cn(
            'w-full h-full',
            isScreenShare ? 'object-contain bg-black' : 'object-cover',
          )}
          style={participant.isLocal && !isScreenShare ? { transform: 'scaleX(-1)' } : undefined}
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

      {/* Audio Track - Using LiveKit's AudioTrack component (only for remote participants) */}
      {!participant.isLocal && audioTrackRef && <AudioTrack trackRef={audioTrackRef} />}

      {/* Participant Info Overlay */}
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
                ? 'right-7'
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

      {/* Network quality indicator */}
      {(networkQuality === ConnectionQuality.Poor || networkQuality === ConnectionQuality.Lost) && (
        <div
          className={cn(
            'absolute rounded-full visual-regression-hide',
            compact ? 'bottom-0.5 right-0.5 p-0.5' : 'bottom-1 right-1 sm:bottom-2 sm:right-2 p-1',
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
