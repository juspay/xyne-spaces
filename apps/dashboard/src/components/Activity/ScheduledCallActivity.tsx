import { ReactElement } from 'react';
import { format } from 'date-fns';
import type { ActivityWithRelated } from '../../types/activity';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { usePlatform } from '../../hooks/usePlatform';
import { useRouteContext } from '../../hooks/useRouteContext';
import { CalendarTimer, NotificationBellOn, CalendarCheck, CalendarCancel } from '@xyne/icons';

export const ScheduledCallActivity = ({
  activity,
  isExpanded,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const actor = useUser(activity.actorId ?? '');
  const { isMobile } = usePlatform();
  const { baseRoute } = useRouteContext();

  if (!actor) return null;

  const isReminder = activity.actorAction === 'call_reminder';
  const isUpdated = activity.actorAction === 'call_updated';
  const isMeetingAccepted = activity.actorAction === 'meeting_accepted';
  const isMeetingDeclined = activity.actorAction === 'meeting_declined';

  const dateParam = activity.call
    ? format(
        new Date(activity.call.startsAt ?? activity.call.startedAt ?? Date.now()),
        'yyyy-MM-dd',
      )
    : null;
  const targetPath =
    !isMobile && activity.callId
      ? `${baseRoute}/calendar?callId=${activity.callId}${dateParam ? `&date=${dateParam}` : ''}`
      : activity.callId
        ? `/calls?tab=upcoming&callId=${activity.callId}`
        : '/calls?tab=upcoming';

  const description = isReminder ? (
    <span className='text-muted-foreground text-sm'>reminded you about a scheduled call in</span>
  ) : isUpdated ? (
    <span className='text-muted-foreground text-sm'>updated a scheduled call in</span>
  ) : isMeetingAccepted ? (
    <span className='text-muted-foreground text-sm'>accepted your meeting invite in</span>
  ) : isMeetingDeclined ? (
    <span className='text-muted-foreground text-sm'>declined your meeting invite in</span>
  ) : (
    <span className='text-muted-foreground text-sm'>scheduled a call in</span>
  );

  const Icon = isReminder
    ? NotificationBellOn
    : isMeetingAccepted
      ? CalendarCheck
      : isMeetingDeclined
        ? CalendarCancel
        : CalendarTimer;
  const iconColor = isReminder
    ? 'text-amber-500'
    : isUpdated
      ? 'text-orange-500'
      : isMeetingAccepted
        ? 'text-green-500'
        : isMeetingDeclined
          ? 'text-red-500'
          : 'text-blue-500';

  return (
    <ActivityItemCard
      activity={activity}
      actorId={actor.id}
      actorName={getUserDisplayName(actor)}
      channelId={activity.channelId ?? undefined}
      badgeIcon={<Icon className={`size-3 ${iconColor}`} />}
      badgeColorClass='bg-muted'
      description={description}
      targetPath={targetPath}
      isExpanded={isExpanded}
      actorAction={activity.actorAction}
      className='flex items-start'
    >
      <div className='text-sm line-clamp-1 truncate whitespace-normal break-all'>
        {isReminder
          ? 'Your call is starting in 10 min'
          : isUpdated
            ? 'A scheduled call was updated'
            : isMeetingAccepted
              ? 'Accepted your meeting invitation'
              : isMeetingDeclined
                ? 'Declined your meeting invitation'
                : 'You have a new scheduled call'}
      </div>
    </ActivityItemCard>
  );
};
