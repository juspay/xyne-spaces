import { ReactElement } from 'react';
import { PhoneMissed } from 'lucide-react';
import type { ActivityWithRelated } from '../../types/activity';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';

/** Activity-feed entry for a missed call; opens the call's detail screen. */
export const MissedCallActivity = ({
  activity,
  isExpanded,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const caller = useUser(activity.actorId ?? '');

  if (!caller) return null;

  // missed_call rows store the call's externalId in actionSourceId.
  const callExternalId = activity.call?.externalId ?? activity.actionSourceId;
  const targetPath = callExternalId ? `/calls/${callExternalId}/detail` : '/calls';

  return (
    <ActivityItemCard
      activity={activity}
      actorId={caller.id}
      actorName={getUserDisplayName(caller)}
      channelId={activity.channelId ?? undefined}
      badgeIcon={<PhoneMissed className='size-3 text-destructive' />}
      badgeColorClass='bg-muted'
      description={<span className='text-muted-foreground text-sm'>called you in</span>}
      targetPath={targetPath}
      isExpanded={isExpanded}
      actorAction={activity.actorAction}
      className='flex items-start'
    >
      <div className='text-sm line-clamp-1 truncate whitespace-normal break-all'>
        {activity.call?.title ? `You missed "${activity.call.title}"` : 'You missed a call'}
      </div>
    </ActivityItemCard>
  );
};
