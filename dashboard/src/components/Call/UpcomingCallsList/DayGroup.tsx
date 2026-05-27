import { format, isToday } from 'date-fns';
import { cn } from '../../../utils/classNames';
import { type Call } from '../../../routes/CallHistoryScreen/callHistoryItem.utils';
import { CallRow } from './CallRow';

export interface DayGroupProps {
  group: { date: Date; calls: Call[] };
  showDivider: boolean;
  userMap: Map<string, { id: string; name: string }>;
  currentUserId?: string | undefined;
  onJoinCall: (call: Call) => void;
  onCallClick?: ((call: Call) => void) | undefined;
  onEditCall?: ((call: Call) => void) | undefined;
  onCancelCall?: ((call: Call) => void) | undefined;
}

export function DayGroup({
  group,
  showDivider,
  userMap,
  currentUserId,
  onJoinCall,
  onCallClick,
  onEditCall,
  onCancelCall,
}: DayGroupProps): React.JSX.Element {
  const dateLabel = format(group.date, 'MMMM d');
  const dayLabel = format(group.date, 'EEE');
  const today = isToday(group.date);

  return (
    <div>
      {showDivider && <div className='border-t border-dashed border-border mx-4' />}
      <div className='flex flex-col md:flex-row md:items-start md:gap-4 gap-3 px-5 py-4'>
        <div className='md:flex md:flex-col md:w-24 md:shrink-0 md:gap-0.5'>
          <p
            className={cn(
              'text-sm font-semibold md:font-medium',
              today ? 'text-primary' : 'text-foreground',
            )}
          >
            <span className='md:hidden'>
              {dateLabel}{' '}
              <span className='text-muted-foreground font-normal'>
                <span className='mx-1 text-base font-bold'>·</span>
                {dayLabel}
              </span>
            </span>
            <span className='hidden md:inline'>{dateLabel}</span>
          </p>
          <p className='text-xs text-muted-foreground hidden md:block'>{dayLabel}</p>
        </div>

        <div className='flex-1 flex flex-col gap-4 min-w-0'>
          {group.calls.length === 0 ? (
            <div className='flex items-center gap-2'>
              <div className='flex-1 flex flex-col gap-0.5 pl-3 border-l-2 border-primary/40 min-w-0'>
                <p className='text-sm font-medium text-foreground'>No calls scheduled</p>
                <p className='text-xs text-muted-foreground'>Nothing planned for this day</p>
              </div>
            </div>
          ) : (
            group.calls.map(call => (
              <CallRow
                key={call.id}
                call={call}
                userMap={userMap}
                currentUserId={currentUserId}
                onJoinCall={onJoinCall}
                onCallClick={onCallClick}
                onEditCall={onEditCall}
                onCancelCall={onCancelCall}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
