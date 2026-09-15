import { ReactElement } from 'react';
import { AlertTriangle } from '@xyne/icons';
import type { ActivityWithRelated } from '../../types/activity';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';

export const MaxWorkloadActivity = ({
  activity,
  isExpanded,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const actor = useUser(activity.actorId);
  const [userGroup] = useCachedQuery(
    queries.getUserGroupById({ userGroupId: activity.actionSourceId }),
  );
  if (!actor) return null;

  const actorName = getUserDisplayName(actor);
  const groupName = userGroup?.name ?? 'This group';
  const targetPath = `/user-groups/${activity.actionSourceId}/assignment-config`;

  return (
    <ActivityItemCard
      activity={activity}
      actorId={activity.actorId}
      actorName={actorName}
      channelId={undefined}
      badgeIcon={<AlertTriangle className='size-3 text-destructive' />}
      badgeColorClass='bg-red-100'
      description={<span className='text-muted-foreground text-sm'>reached max workload</span>}
      targetPath={targetPath}
      isExpanded={isExpanded}
      actorAction={activity.actorAction}
    >
      <div
        className={
          isExpanded ? 'text-sm text-muted-foreground mt-2' : 'text-sm text-muted-foreground'
        }
      >
        {groupName} is at max workload — no one was available for a new ticket.
      </div>
    </ActivityItemCard>
  );
};
