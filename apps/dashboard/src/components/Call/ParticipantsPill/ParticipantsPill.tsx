import { useMemo } from 'react';
import { Hand, Users } from 'lucide-react';
import type { ParticipantInfo } from '../../../machines/roomMachine';
import { cn } from '../../../utils/classNames';
import { useProfilePictureUrl } from '../../../hooks/useProfilePicture';
import { ParticipantAvatar } from '../ParticipantAvatar/ParticipantAvatar';
import { getAvatarColors } from '../ParticipantAvatar/avatarColors';
import { getParticipantPicturePath } from '../callParticipant.utils';
import { isTranscriptionAgentIdentity } from '../../../utils/livekitAgent';

const MAX_FACES = 3;

function FaceAvatar({ participant }: { participant: ParticipantInfo }): React.ReactElement {
  const { url } = useProfilePictureUrl(
    participant.identity,
    getParticipantPicturePath(participant.participant),
  );
  return (
    <ParticipantAvatar
      name={participant.name || 'Unknown'}
      size='xs'
      pictureUrl={url}
      backgroundColor={getAvatarColors(participant.identity).avatar}
      className='!h-7 !w-7 !text-[11px] shadow-none ring-2 ring-[#333537] group-hover:ring-[#404245] group-aria-pressed:ring-[#a8c7fa]'
    />
  );
}

interface ParticipantsPillProps {
  participants: ParticipantInfo[];
  /** People waiting in the lobby — shown as a red badge. */
  requestCount: number;
  raisedHandCount: number;
  isOpen: boolean;
  onClick: () => void;
}

/**
 * Top-right people button (Meet's placement): a small face pile with the head
 * count, plus raised-hand and join-request signals so they're visible without
 * opening the panel.
 */
export function ParticipantsPill({
  participants,
  requestCount,
  raisedHandCount,
  isOpen,
  onClick,
}: ParticipantsPillProps): React.ReactElement {
  const humans = useMemo(
    () => participants.filter(p => !isTranscriptionAgentIdentity(p.identity)),
    [participants],
  );
  // Show other people's faces first — your own face tells you nothing.
  const faces = useMemo(
    () => [...humans].sort((a, b) => Number(a.isLocal) - Number(b.isLocal)).slice(0, MAX_FACES),
    [humans],
  );
  // People only — Xyne Automatic isn't a participant to count.
  const count = humans.length;
  const label =
    `People — ${count} in the call` +
    (raisedHandCount > 0
      ? `, ${raisedHandCount} hand${raisedHandCount === 1 ? '' : 's'} raised`
      : '') +
    (requestCount > 0 ? `, ${requestCount} waiting to join` : '');

  return (
    <button
      type='button'
      onClick={onClick}
      aria-pressed={isOpen}
      aria-label={label}
      title={label}
      className={cn(
        'group relative flex h-10 items-center gap-2 rounded-full pl-1.5 pr-3.5 text-sm font-medium transition-colors',
        'outline-none focus-visible:ring-2 focus-visible:ring-[#a8c7fa] focus-visible:ring-offset-2 focus-visible:ring-offset-[#131314]',
        isOpen ? 'bg-[#a8c7fa] text-[#062e6f]' : 'bg-[#333537] text-[#e3e3e3] hover:bg-[#404245]',
      )}
      data-testid='add-participant-button'
      data-track-event='BUTTON_CLICK'
      data-track-category='CALLS'
      data-track-name='TOGGLE_PARTICIPANTS_SIDEBAR'
      data-track-metadata={JSON.stringify({ isOpen, source: 'top_bar' })}
    >
      {faces.length > 0 ? (
        <span className='flex -space-x-2'>
          {faces.map(p => (
            <FaceAvatar key={p.identity} participant={p} />
          ))}
        </span>
      ) : (
        <Users className='ml-1 h-4 w-4' />
      )}
      <span className='tabular-nums' data-testid='participant-count'>
        {count}
      </span>

      {raisedHandCount > 0 && (
        <span className='flex items-center gap-0.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white'>
          <Hand className='h-3 w-3' />
          {raisedHandCount}
        </span>
      )}

      {requestCount > 0 && (
        <span
          className='absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#dc362e] px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-[#131314]'
          data-testid='participants-request-count'
        >
          {requestCount > 99 ? '99+' : requestCount}
        </span>
      )}
    </button>
  );
}
