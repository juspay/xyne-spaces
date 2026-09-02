import { format } from 'date-fns';
import { MoreVertical } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { CallStatus } from '@xyne/shared';
import {
  getPreviewParticipantUserIds,
  getCallParticipantCount,
  type Call,
} from '../../../routes/CallHistoryScreen/callHistoryItem.utils';
import Button from '../../ui/Button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../../ui/dropdown-menu';
import { formatParticipantText } from '../../../hooks/useCalls';
import { UpcomingCallActionsMenuItems } from './UpcomingCallActionsMenu';

export interface CallRowProps {
  call: Call;
  userMap: Map<string, { id: string; name: string }>;
  currentUserId?: string | undefined;
  onJoinCall: (call: Call) => void;
  onCallClick?: ((call: Call) => void) | undefined;
  onEditCall?: ((call: Call) => void) | undefined;
  onCancelCall?: ((call: Call) => void) | undefined;
}

export function CallRow({
  call,
  userMap,
  currentUserId,
  onJoinCall,
  onCallClick,
  onEditCall,
  onCancelCall,
}: CallRowProps): React.JSX.Element {
  const isActive = call.status === CallStatus.ACTIVE || call.status === CallStatus.IN_PROGRESS;
  const isEnded = call.status === CallStatus.ENDED;
  const title = call.title || 'Scheduled Call';
  const startTime = call.startsAt ? format(new Date(call.startsAt), 'h:mm a') : '';
  const participants = formatParticipantText(
    getPreviewParticipantUserIds(call.participantPreviewUserIds, currentUserId).map(userId => ({
      userId,
    })),
    userMap,
    getCallParticipantCount(call),
  );
  const isOwner = currentUserId === call.createdByUserId;

  return (
    <div className='flex items-center gap-2'>
      <div
        role={onCallClick ? 'button' : undefined}
        tabIndex={onCallClick ? 0 : undefined}
        className={cn(
          'relative flex-1 flex flex-col gap-0.5 pl-5 min-w-0',
          onCallClick && 'cursor-pointer',
        )}
        onClick={onCallClick ? () => onCallClick(call) : undefined}
        onKeyDown={
          onCallClick
            ? e => {
                if (e.key === 'Enter' || e.key === ' ') onCallClick(call);
              }
            : undefined
        }
        data-track-category='CALLS'
        data-track-name='upcoming-call-click'
      >
        <div
          className={cn(
            'absolute left-0 top-0 bottom-0 w-1 rounded-full',
            isActive ? 'bg-status-success' : 'bg-primary/40',
          )}
        />
        <p className='text-sm font-medium text-foreground truncate'>{title}</p>
        <p className='text-xs text-muted-foreground'>
          {startTime}
          {participants && ` • ${participants}`}
        </p>
      </div>
      {!isEnded && (
        <Button
          variant='outline'
          size='sm'
          onClick={e => {
            e.stopPropagation();
            onJoinCall(call);
          }}
          data-track-category='CALLS'
          data-track-name='JOIN_UPCOMING_CALL'
          className={cn(
            'shrink-0 text-sm',
            isActive
              ? 'border-status-success text-status-success hover:bg-accent'
              : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          Join Now
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            className='shrink-0 size-6 p-0 text-muted-foreground hover:text-foreground'
            data-track-category='CALLS'
            data-track-name='upcoming-call-more-options'
            onClick={e => e.stopPropagation()}
            aria-label='More options'
          >
            <MoreVertical className='size-3.5' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='rounded-xl p-1.5 w-44 shadow-sm'>
          <UpcomingCallActionsMenuItems
            call={call}
            isOwner={isOwner}
            onEdit={onEditCall ? () => onEditCall(call) : undefined}
            onCancel={onCancelCall ? () => onCancelCall(call) : undefined}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
