import {
  CheckTickCircle as CircleCheck,
  CircleDashed,
  CircleDot,
  MultipleCrossCancelDefault as X,
  PauseCircle,
} from '@xyne/icons';
import { TicketStatusV2 } from '@xyne/shared';
import UserAvatar, { AvatarShape, AvatarSize } from '../../UserAvatar/UserAvatar';
import { cn } from '../../../utils/classNames';

interface TicketLinkChipProps {
  xyneId: string;
  title: string;
  assignedTo?: string | null | undefined;
  statusV2?: string | null | undefined;
  removable?: boolean;
  onClear?: (() => void) | undefined;
  onClick?: (() => void) | undefined;
  className?: string;
}

const statusIconFor = (statusV2?: string | null): React.ReactElement => {
  const className = 'size-[18px] shrink-0';
  switch (statusV2) {
    case TicketStatusV2.COMPLETED:
      return <CircleCheck className={cn(className, 'text-green-600')} />;
    case TicketStatusV2.STARTED:
      return <CircleDot className={cn(className, 'text-blue-600')} />;
    case TicketStatusV2.PAUSED:
    case TicketStatusV2.CANCELLED:
      return <PauseCircle className={cn(className, 'text-muted-foreground')} />;
    case TicketStatusV2.TODO:
    default:
      return <CircleDashed className={cn(className, 'text-muted-foreground')} />;
  }
};

export const TicketLinkChip: React.FC<TicketLinkChipProps> = ({
  xyneId,
  title,
  assignedTo,
  statusV2,
  removable = true,
  onClear,
  onClick,
  className,
}) => {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={e => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg border border-input bg-background px-3 py-2',
        onClick && 'cursor-pointer hover:border-ring',
        className,
      )}
      data-track-category='Tickets'
      data-track-name='TicketLinkChipOpen'
      data-track-metadata={JSON.stringify({ xyneId })}
    >
      {statusIconFor(statusV2)}
      <span className='max-w-[45%] shrink-0 truncate font-mono text-[13px] text-muted-foreground'>
        {xyneId}
      </span>
      <span className='min-w-0 flex-1 truncate text-sm font-medium text-foreground'>{title}</span>
      {assignedTo ? (
        <UserAvatar userId={assignedTo} size={AvatarSize.SM} shape={AvatarShape.CIRCULAR} />
      ) : null}
      {removable && onClear ? (
        <button
          type='button'
          onClick={e => {
            e.stopPropagation();
            onClear();
          }}
          className='rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
          aria-label='Clear linked ticket'
          data-track-category='Tickets'
          data-track-name='ClearTicketLink'
        >
          <X className='size-3.5' />
        </button>
      ) : null}
    </div>
  );
};
