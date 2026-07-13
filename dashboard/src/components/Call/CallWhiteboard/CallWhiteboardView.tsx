import type { Room } from 'livekit-client';
import { Track } from 'livekit-client';
import type { ParticipantInfo } from '../../../machines/roomMachine';
import { cn } from '../../../utils/classNames';
import { ParticipantTile } from '../ParticipantTile/ParticipantTile';
import { sortParticipants } from '../ParticipantGrid/sortParticipants';
import { CallWhiteboard } from './CallWhiteboard';
import { useMemo } from 'react';

interface CallWhiteboardViewProps {
  participants: ParticipantInfo[];
  room: Room | null;
  className?: string | undefined;
  compact?: boolean | undefined;
  showSidebar?: boolean | undefined;
  displayOnly?: boolean | undefined;
  aiController?: { id: string; name: string } | null;
  requestedAiController?: boolean;
}

export function CallWhiteboardView({
  participants,
  room,
  className = '',
  compact = false,
  showSidebar = true,
  displayOnly = false,
  aiController,
  requestedAiController,
}: CallWhiteboardViewProps): React.ReactElement {
  const isAIAssistantEnabled = aiController !== null;
  const sortedParticipants = useMemo(
    () => sortParticipants(participants, isAIAssistantEnabled),
    [participants, isAIAssistantEnabled],
  );

  return (
    <div className={cn('h-full w-full flex overflow-hidden', className)}>
      <div className='flex-1 min-w-0 overflow-hidden'>
        <CallWhiteboard room={room} className='h-full' displayOnly={displayOnly} />
      </div>

      {showSidebar && (
        <aside
          className={cn(
            'hidden sm:flex flex-col gap-2 sm:gap-3 p-2 sm:p-4 overflow-y-auto bg-gray-950/50 backdrop-blur-sm',
            compact ? 'w-20' : 'w-56 md:w-64 lg:w-80',
          )}
        >
          {sortedParticipants.map(participant => {
            const isSharing = participant.participant
              ? participant.participant.getTrackPublication(Track.Source.ScreenShare)?.isSubscribed
              : participant.isScreenShareEnabled;

            return (
              <ParticipantTile
                key={participant.identity}
                participant={participant}
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
                data-track-name='Whiteboard_Participant_Tile'
                data-track-metadata={JSON.stringify({ participantIdentity: participant.identity })}
              />
            );
          })}
        </aside>
      )}
    </div>
  );
}
