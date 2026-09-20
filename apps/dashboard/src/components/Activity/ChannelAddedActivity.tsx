import { ReactElement } from 'react';
import { UserTwo } from '@xyne/icons';
import { ChannelScopeType } from '@xyne/shared';
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

  // The same participant insert backs group DMs, where the user-facing concept
  // is a group DM rather than a channel — and the route differs too.
  const isGroupDm = channel?.scopeType === ChannelScopeType.GROUP_DM;
  const targetPath = isGroupDm ? `${baseRoute}/dir/${channelId}` : `${baseRoute}/${channelId}`;

  return (
    <ActivityItemCard
      activity={activity}
      actorId={actor.id}
      actorName={getUserDisplayName(actor)}
      channelId={channelId}
      badgeIcon={<UserTwo className='size-3 text-primary' />}
      badgeColorClass='bg-muted'
      description={
        <span className='text-muted-foreground text-sm'>
          {isGroupDm ? 'added you to a group DM' : 'added you to a channel'}
        </span>
      }
      targetPath={targetPath}
      isExpanded={isExpanded}
      actorAction={activity.actorAction}
      unresolvedChannelLabel='Private channel'
    >
      <div className='text-muted-foreground text-sm'>
        {isGroupDm
          ? 'You now have access to this group DM.'
          : `You now have access to ${channel?.name ? `#${channel.name}` : 'this channel'}.`}
      </div>
    </ActivityItemCard>
  );
};
