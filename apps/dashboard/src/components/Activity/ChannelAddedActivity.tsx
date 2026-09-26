import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { UserPlus } from '@xyne/icons';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { useRouteContext } from '../../hooks/useRouteContext';

/** Renders an `added_to_channel` activity: "X added you to this channel". */
export const ChannelAddedActivity = ({
  activity,
  isExpanded,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const { baseRoute } = useRouteContext();
  const channelId = activity.channelId ?? undefined;
  const sender = useUser(activity.actorId ?? '');

  if (!channelId) return null;

  return (
    <ActivityItemCard
      activity={activity}
      actorId={sender?.id ?? activity.actorId ?? ''}
      actorName={getUserDisplayName(sender)}
      channelId={channelId}
      badgeIcon={<UserPlus className='size-3 text-primary' />}
      badgeColorClass='bg-muted'
      description={<span className='text-muted-foreground text-sm'>added you to a channel</span>}
      targetPath={`${baseRoute}/${channelId}`}
      isExpanded={isExpanded}
      className='flex items-start'
      unresolvedChannelLabel='Private channel'
    >
      <div className='text-muted-foreground text-sm'>Open channel</div>
    </ActivityItemCard>
  );
};
