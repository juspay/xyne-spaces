import { useState } from 'react';
import { PhoneCall, PhoneOff } from 'lucide-react';
import { RingStatus } from '@xyne/shared';
import { useUser } from '../../../hooks/useUsers';
import { useProfilePictureUrl } from '../../../hooks/useProfilePicture';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { cn } from '../../../utils/classNames';
import { ParticipantAvatar } from '../ParticipantAvatar/ParticipantAvatar';
import { getAvatarColors } from '../ParticipantAvatar/avatarColors';
import { getRingStatusLabel } from '../ringStatus.utils';

interface RingingParticipantTileProps {
  userId: string;
  ringStatus: RingStatus;
  avatarSize?: 'small' | 'medium' | 'large' | undefined;
  compact?: boolean | undefined;
}

/** Placeholder tile for an invitee who hasn't joined; backdrop mirrors `ParticipantTile`. */
export function RingingParticipantTile({
  userId,
  ringStatus,
  avatarSize = 'large',
  compact = false,
}: RingingParticipantTileProps): React.ReactElement {
  const user = useUser(userId);
  const { url: pictureUrl } = useProfilePictureUrl(userId, user?.picture);
  const name = getUserDisplayName(user);
  const colors = getAvatarColors(userId);
  const isBusy = ringStatus === RingStatus.BUSY;
  const isRinging = ringStatus === RingStatus.RINGING;
  const StatusIcon = isBusy ? PhoneOff : PhoneCall;

  const [pictureBackdropFailed, setPictureBackdropFailed] = useState(false);
  const showPictureBackdrop = !!pictureUrl && !pictureBackdropFailed;

  return (
    <div
      className={cn(
        'relative bg-[#1e1f20] overflow-hidden flex flex-col items-center justify-center',
        compact ? 'rounded-xl gap-1' : 'rounded-2xl gap-2 sm:gap-3',
      )}
      style={
        showPictureBackdrop
          ? undefined
          : {
              // Same identity wash a joined tile falls back to without a picture.
              backgroundImage: `radial-gradient(115% 95% at 50% 45%, ${colors.background} 0%, rgba(30,31,32,0) 60%)`,
            }
      }
      aria-label={`${name}: ${getRingStatusLabel(ringStatus)}`}
      data-testid='ringing-participant-tile'
    >
      {showPictureBackdrop ? (
        <>
          {/* Scaled past the edges so the blur's soft border is clipped away. */}
          <img
            src={pictureUrl}
            alt=''
            aria-hidden
            onError={() => setPictureBackdropFailed(true)}
            className={cn(
              'pointer-events-none absolute inset-0 h-full w-full object-cover',
              'scale-150 saturate-150 visual-regression-hide',
              compact ? 'blur-xl' : 'blur-2xl sm:blur-3xl',
            )}
          />
          {/* Same radial scrim `ParticipantTile` uses. */}
          <div
            aria-hidden
            className='pointer-events-none absolute inset-0'
            style={{
              background:
                'radial-gradient(115% 95% at 50% 45%, rgba(30,31,32,0.35) 0%, rgba(30,31,32,0.92) 75%)',
            }}
          />
        </>
      ) : (
        /* Faint halo so the avatar sits in the wash rather than on top of it. */
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute rounded-full blur-2xl opacity-[0.08]',
            compact ? 'h-16 w-16' : 'h-28 w-28 sm:h-36 sm:w-36',
          )}
          style={{ backgroundColor: colors.avatar }}
        />
      )}

      <div className='relative flex items-center justify-center'>
        {isRinging && (
          <span
            aria-hidden
            className='absolute inset-0 rounded-full animate-ping opacity-30'
            style={{ backgroundColor: colors.avatar }}
          />
        )}
        <ParticipantAvatar
          name={name}
          size={avatarSize}
          backgroundColor={colors.avatar}
          pictureUrl={pictureUrl}
          className='relative shadow-none ring-1 ring-white/15'
        />
      </div>

      <div
        className={cn(
          'relative flex items-center text-white/90',
          compact ? 'gap-1 text-[9px]' : 'gap-1.5 text-xs sm:text-sm',
        )}
      >
        <StatusIcon
          className={cn(
            'flex-shrink-0',
            isBusy ? 'text-amber-300' : 'text-white/80',
            isRinging && 'animate-pulse',
            compact ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5',
          )}
        />
        <span>{getRingStatusLabel(ringStatus)}</span>
      </div>

      <div
        className={cn(
          'absolute z-10 flex items-center rounded-lg bg-black/45 backdrop-blur-md',
          'ring-1 ring-inset ring-white/15 text-white font-medium visual-regression-hide',
          compact
            ? 'bottom-1 left-1 px-1.5 py-0.5 text-[9px] max-w-[calc(100%-0.5rem)]'
            : 'bottom-1.5 left-1.5 px-2 py-1 text-[10px] sm:bottom-2.5 sm:left-2.5 sm:text-xs max-w-[calc(100%-1rem)]',
        )}
      >
        <span className='truncate'>{name}</span>
      </div>
    </div>
  );
}
