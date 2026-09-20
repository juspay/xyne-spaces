import { ReactElement } from 'react';
import { UserTwo } from '@xyne/icons';
import type { ActivityWithRelated } from '../../types/activity';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';
import { useChannel } from '../../hooks/useChannels';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { useRouteContext } from '../../hooks/useRouteContext';

/**
 * Renders "X added you to #channel".
 *
 * Being added to a channel used to be push-only, so a user who missed the
 * notification had no record of it. This mirrors it into the activity feed
 * alongside the mention activity, so both reasons they now have access are
 * visible in one place.
 */
export const ChannelAddedActivity = ({
  activity,
  isExpanded,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const { baseRoute } = useRouteContext();
  const channelId = activity.channelId ?? activity.actionSourceId;
  const actor = useUser(activity.actorId);
  const channel = useChannel(channelId || '');

  if (!channelId || !actor) return null;

  return (
    <ActivityItemCard
      activity={activity}
      actorId={actor.id}
      actorName={getUserDisplayName(actor)}
      channelId={channelId}
      badgeIcon={<UserTwo className='size-3 text-primary' />}
      badgeColorClass='bg-muted'
      description={<span className='text-muted-foreground text-sm'>added you to a channel</span>}
      targetPath={`${baseRoute}/${channelId}`}
      isExpanded={isExpanded}
      actorAction={activity.actorAction}
      unresolvedChannelLabel='Private channel'
    >
      <div className='text-muted-foreground text-sm'>
        You now have access to {channel?.name ? `#${channel.name}` : 'this channel'}.
      </div>
    </ActivityItemCard>
  );
};
