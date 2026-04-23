import { format } from 'date-fns';
import { cn } from '../../../utils/classNames';
import {
  isScheduledCallJoinable,
  type Call,
} from '../../../routes/CallHistoryScreen/callHistoryItem.utils';
import Button from '../../ui/Button';

interface UpcomingCallsListProps {
  calls: Call[];
  onJoinCall: (call: Call) => void;
  max?: number;
  className?: string;
}

export function UpcomingCallsList({
  calls,
  onJoinCall,
  max = 20,
  className,
}: UpcomingCallsListProps): React.JSX.Element {
  const visible = calls.slice(0, max);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {visible.map(call => {
        const startsAt = call.startsAt ? new Date(call.startsAt) : new Date();
        const endsAt = call.endsAt ? new Date(call.endsAt) : null;
        const title = call.title ?? 'Scheduled Call';
        const joinable = isScheduledCallJoinable(call);

        const startTime = format(startsAt, 'h:mm a');
        const endTime = endsAt ? format(endsAt, 'h:mm a') : null;

        return (
          <div
            key={call.id}
            className={cn(
              'group flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4',
              'pl-3 border-l-2 transition-colors duration-150 rounded-r-sm',
              joinable ? 'border-status-success' : 'border-primary/25 hover:border-primary/50',
            )}
          >
            {/* Content */}
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

            {/* Join Call button — always visible for joinable calls, hover-only otherwise */}
            <Button
              variant='outline'
              size='sm'
              onClick={() => onJoinCall(call)}
              tabIndex={joinable ? 0 : -1}
              className={cn(
                'w-full justify-center sm:w-auto sm:shrink-0 transition-opacity duration-150',
                joinable
                  ? 'border-status-success text-status-success hover:bg-accent opacity-100'
                  : 'opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto',
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
