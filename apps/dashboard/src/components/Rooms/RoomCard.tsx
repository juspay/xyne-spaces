import { ReactElement } from 'react';
import { FolderKanban, Lock } from 'lucide-react';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { cn } from '../../utils/classNames';
import { Button } from '../ui/Button';
import type { RoomWithMembership } from '@xyne/shared';
import { formatUpdatedAt, getRoomOwnerId } from './Rooms.utils';

interface RoomCardProps {
  entry: RoomWithMembership;
  projectName?: string | undefined;
  onOpen: (roomId: string) => void;
  onRequestAccess: (roomId: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function RoomCard({
  entry,
  projectName,
  onOpen,
  onRequestAccess,
  className,
  style,
}: RoomCardProps): ReactElement {
  const { room, membershipState } = entry;
  const ownerId = getRoomOwnerId(room.members);
  const owner = useUser(ownerId ?? '');

  const handleOpen = (): void => {
    onOpen(room.id);
  };

  const handleRequestAccess = (event: React.MouseEvent): void => {
    event.stopPropagation();
    onRequestAccess(room.id);
  };

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleOpen();
    }
  };

  return (
    <div
      data-slot='room-card'
      data-testid={`room-card-${room.id}`}
      role='button'
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={handleKeyDown}
      data-track-category='Rooms'
      data-track-name='OpenRoom'
      data-track-metadata={JSON.stringify({ roomId: room.id })}
      style={style}
      className={cn(
        'group flex flex-col gap-3 rounded-2xl border border-border bg-background p-5 text-left',
        'cursor-pointer transition-[box-shadow,border-color,scale] duration-150 ease-out',
        'hover:border-border hover:shadow-md active:scale-[0.99]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <div className='flex items-start justify-between gap-3'>
        <h3 className='flex min-w-0 items-center gap-2 text-base font-semibold text-foreground'>
          <Lock size={14} className='shrink-0 text-muted-foreground' />
          <span className='truncate'>{room.name}</span>
        </h3>
        {membershipState === 'none' && (
          <Button
            variant='outline'
            size='sm'
            className='shrink-0'
            onClick={handleRequestAccess}
            data-track-category='Rooms'
            data-track-name='RequestRoomAccess'
          >
            Request access
          </Button>
        )}
        {membershipState === 'pending' && (
          <span className='shrink-0 whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground'>
            Requested
          </span>
        )}
      </div>
      {projectName && (
        <span className='-mt-1.5 inline-flex w-fit items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground'>
          <FolderKanban size={11} />
          <span className='truncate'>{projectName}</span>
        </span>
      )}
      <p className='line-clamp-2 text-sm text-muted-foreground [text-wrap:pretty]'>
        {room.description}
      </p>
      <div className='mt-auto flex items-center justify-between gap-2 text-xs text-muted-foreground'>
        <span className='truncate'>
          {ownerId ? (
            <>
              Created by{' '}
              <span className='font-medium text-foreground'>
                {owner ? getUserDisplayName(owner) : '…'}
              </span>
            </>
          ) : null}
        </span>
        <span className='whitespace-nowrap tabular-nums'>
          Updated {formatUpdatedAt(room.updatedAt)}
        </span>
      </div>
    </div>
  );
}
