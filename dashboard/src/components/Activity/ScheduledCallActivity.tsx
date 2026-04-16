import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';
import { CalendarClock, Bell } from 'lucide-react';

export const ScheduledCallActivity = ({
  activity,
  isExpanded,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const actor = useUser(activity.actorId ?? '');

  if (!actor) return null;

  const isReminder = activity.actorAction === 'call_reminder';
  const isUpdated = activity.actorAction === 'call_updated';
  const targetPath = '/calls';

  const description = isReminder ? (
    <span className='text-muted-foreground text-sm'>reminded you about a scheduled call in</span>
  ) : isUpdated ? (
    <span className='text-muted-foreground text-sm'>updated a scheduled call in</span>
  ) : (
    <span className='text-muted-foreground text-sm'>scheduled a call in</span>
  );

  const Icon = isReminder ? Bell : CalendarClock;
  const iconColor = isReminder ? 'text-amber-500' : isUpdated ? 'text-orange-500' : 'text-blue-500';

  return (
    <ActivityItemCard
      activity={activity}
      actorId={actor.id}
      actorName={actor.name}
      channelId={activity.channelId ?? undefined}
      badgeIcon={<Icon className={`w-4 h-4 ${iconColor}`} />}
      badgeColorClass='bg-muted'
      description={description}
      targetPath={targetPath}
      isExpanded={isExpanded}
      actorAction={activity.actorAction}
      className='flex items-start'
    >
      <div className='text-foreground text-sm line-clamp-1 truncate whitespace-normal break-all'>
        {isReminder
          ? 'Your call is starting in 10 min'
          : isUpdated
            ? 'A scheduled call was updated'
            : 'You have a new scheduled call'}
      </div>
    </ActivityItemCard>
  );
};
