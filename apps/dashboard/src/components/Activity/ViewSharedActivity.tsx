import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { Share01 } from '@xyne/icons';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';
import { useAuth } from '../../hooks/useAuth';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { getUserDisplayName } from '../../utils/userDisplayName';

/**
 * Renders a ticket "view" (SavedUserConfiguration) sharing / access-revoked activity:
 * - view_shared: "X shared a view with you"
 * - view_access_revoked: "X revoked your access to a view"
 *
 * The view id is carried on the activity's actionSourceId (no dedicated column).
 * The view name is best-effort resolved from the current user's shared views; on a
 * revoke the grant is gone, so it gracefully falls back to a generic label.
 */
export const ViewSharedActivity = ({
  activity,
  isExpanded,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const { user } = useAuth();
  const viewId = activity.actionSourceId ?? undefined;
  const actorId = activity.actorId ?? '';
  const sender = useUser(actorId);

  const [sharedViews] = useCachedQuery(
    queries.savedConfigsSharedWithUser({ userId: user?.id ?? '' }),
    { enabled: Boolean(user?.id) },
  );
  const viewName = (sharedViews ?? []).find(row => row.viewId === viewId)?.view?.name ?? 'a view';

  if (!viewId) return null;

  const targetPath = `/projects/views/${viewId}`;

  const isAccessRevoked = activity.actorAction === 'view_access_revoked';
  const descriptionText = isAccessRevoked
    ? 'revoked your access to a view'
    : 'shared a view with you';

  return (
    <ActivityItemCard
      activity={activity}
      actorId={sender?.id ?? actorId}
      actorName={getUserDisplayName(sender)}
      channelId={activity.channelId ?? undefined}
      badgeIcon={<Share01 className='size-3 text-primary' />}
      badgeColorClass='bg-muted'
      description={<span className='text-muted-foreground text-sm'>{descriptionText}</span>}
      targetPath={targetPath}
      isExpanded={isExpanded}
      className='flex items-start'
      unresolvedChannelLabel='Private channel'
    >
      <div className='text-muted-foreground text-sm'>
        {isExpanded ? `View: ${viewName}` : `Open view: ${viewName}`}
      </div>
    </ActivityItemCard>
  );
};
