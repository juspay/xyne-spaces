import { format } from 'date-fns';
import { CallStatus } from '@xyne/shared';
import { cn } from '../../../utils/classNames';
import { type Call } from '../../../routes/CallHistoryScreen/callHistoryItem.utils';
import Button from '../../ui/Button';
import { GroupedList } from './GroupedList';

interface UpcomingCallsListProps {
  calls: Call[];
  onJoinCall: (call: Call) => void;
  onCallClick?: ((call: Call) => void) | undefined;
  onEditCall?: ((call: Call) => void) | undefined;
  onCancelCall?: ((call: Call) => void) | undefined;
  currentUserId?: string | undefined;
  grouped?: boolean | undefined;
  max?: number | undefined;
  className?: string | undefined;
  selectedDay?: Date | undefined;
}

export function UpcomingCallsList({
  calls,
  onJoinCall,
  onCallClick,
  onEditCall,
  onCancelCall,
  currentUserId,
  grouped = false,
  max = 20,
  className,
  selectedDay,
}: UpcomingCallsListProps): React.JSX.Element {
  if (grouped) {
    return (
      <GroupedList
        calls={calls}
        onJoinCall={onJoinCall}
        onCallClick={onCallClick}
        onEditCall={onEditCall}
        onCancelCall={onCancelCall}
        currentUserId={currentUserId}
        selectedDay={selectedDay}
      />
    );
  }

  const visible = calls.slice(0, max);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {visible.map(call => {
        const startsAt = call.startsAt ? new Date(call.startsAt) : new Date();
        const endsAt = call.endsAt ? new Date(call.endsAt) : null;
        const title = call.title ?? 'Scheduled Call';
        const isActive =
          call.status === CallStatus.ACTIVE || call.status === CallStatus.IN_PROGRESS;

        const startTime = format(startsAt, 'h:mm a');
        const endTime = endsAt ? format(endsAt, 'h:mm a') : null;

        return (
          <div
            key={call.id}
            className={cn(
              'group flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4',
              'pl-3 border-l-2 transition-colors duration-150 rounded-r-sm',
              isActive ? 'border-status-success' : 'border-primary/25 hover:border-primary/50',
            )}
          >
            <div className='flex min-w-0 flex-1 items-center gap-2 overflow-hidden py-1 sm:py-2'>
              <div className='flex flex-1 flex-col gap-1 min-w-0'>
                <p className='truncate text-[14px] font-medium leading-[1.2] text-foreground'>
                  {title}
                </p>
                <p className='text-[12px] leading-[1.2] text-muted-foreground'>
                  {startTime}
                  {endTime && ` - ${endTime}`}
                </p>
              </div>
            </div>

            <Button
              variant='outline'
              size='sm'
              onClick={() => onJoinCall(call)}
              data-track-category='Calls'
              data-track-name='JOIN_UPCOMING_CALL'
              tabIndex={0}
              className={cn(
                'w-full justify-center sm:w-auto sm:shrink-0 transition-opacity duration-150',
                isActive
                  ? 'border-status-success text-status-success hover:bg-accent opacity-100'
                  : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              Join Call
            </Button>
          </div>
        );
      })}
    </div>
  );
}

export default UpcomingCallsList;
