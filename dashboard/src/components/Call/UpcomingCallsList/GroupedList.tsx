import { useMemo } from 'react';
import { isSameDay } from '../../../utils/dateUtils';
import { groupByDay, type Call } from '../../../routes/CallHistoryScreen/callHistoryItem.utils';
import { useUsers } from '../../../hooks/useUsers';
import { DayGroup } from './DayGroup';

interface GroupedListProps {
  calls: Call[];
  onJoinCall: (call: Call) => void;
  onCallClick?: ((call: Call) => void) | undefined;
  onEditCall?: ((call: Call) => void) | undefined;
  onCancelCall?: ((call: Call) => void) | undefined;
  currentUserId?: string | undefined;
  selectedDay?: Date | undefined;
}

export function GroupedList({
  calls,
  onJoinCall,
  onCallClick,
  onEditCall,
  onCancelCall,
  currentUserId,
  selectedDay,
}: GroupedListProps): React.JSX.Element {
  const allUsers = useUsers();
  const userMap = useMemo(
    () => new Map(allUsers.map(u => [u.id, { id: u.id, name: u.name }])),
    [allUsers],
  );

  const dayGroups = useMemo(() => {
    if (selectedDay) {
      const dayCalls = calls.filter(
        call => call.startsAt && isSameDay(new Date(call.startsAt), selectedDay),
      );
      return [{ date: selectedDay, calls: dayCalls }];
    }
    return groupByDay(calls).slice(0, 2);
  }, [calls, selectedDay]);

  if (dayGroups.length === 0) {
    return (
      <div className='border border-border rounded-xl px-5 py-8 flex items-center justify-center'>
        <p className='text-sm text-muted-foreground'>No upcoming calls scheduled</p>
      </div>
    );
  }

  return (
    <div className='border border-border rounded-xl overflow-hidden'>
      {dayGroups.map((group, idx) => (
        <DayGroup
          key={group.date.toISOString()}
          group={group}
          showDivider={idx > 0}
          userMap={userMap}
          currentUserId={currentUserId}
          onJoinCall={onJoinCall}
          onCallClick={onCallClick}
          onEditCall={onEditCall}
          onCancelCall={onCancelCall}
        />
      ))}
    </div>
  );
}
