import { Track } from 'livekit-client';
import { MicOff, Monitor } from 'lucide-react';
import type { ParticipantInfo } from '../../../machines/roomMachine';
import { ParticipantAvatar } from '../ParticipantAvatar/ParticipantAvatar';
import { cn } from '../../../utils/classNames';

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
        />
      ) : (
        <div className='flex items-center justify-center w-full h-full bg-gradient-to-br from-gray-700 to-gray-800'>
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
            <ParticipantAvatar name={participant.name || 'Unknown'} size={avatarSize} />
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
