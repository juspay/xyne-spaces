import { ReactElement } from 'react';
import { Share01 } from '@xyne/icons';
import type { ActivityWithRelated } from '../../types/activity';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';

/**
 * Renders a saved-view sharing or access-revoked activity:
 * - view_shared:         "X shared a view with you"        + "Open view: <name>"
 * - view_access_revoked: "X revoked your access to a view" + "Open view: <name>"
 *
 * Clicking opens the view via /projects/views/:viewId (ProjectViewBuilder), which
 * loads any saved view by id — owned, shared, board- or desk-context — and applies
 * its filters. This is the same deeplink the sidebar's "open view" uses.
 */
export const ViewSharedActivity = ({
  activity,
  isExpanded,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const view = activity.savedView;
  const viewId = activity.savedViewId ?? undefined;
  const actorId = activity.actorId ?? '';
  const sender = useUser(actorId);

  if (!viewId) return null;

  const targetPath = `/projects/views/${viewId}`;

  const isRevoked = activity.actorAction === 'view_access_revoked';
  const descriptionText = isRevoked ? 'revoked your access to a view' : 'shared a view with you';

  return (
    <ActivityItemCard
      activity={activity}
      actorId={sender?.id ?? actorId}
      actorName={getUserDisplayName(sender)}
      channelId={activity.channelId ?? undefined}
      badgeIcon={<Share01 className='size-3 text-primary' />}
      badgeColorClass='bg-muted'
      description={<span className='text-sm text-muted-foreground'>{descriptionText}</span>}
      targetPath={targetPath}
      supportTargetPath={targetPath}
      isExpanded={isExpanded}
      className='flex items-start'
      unresolvedChannelLabel='Private channel'
    >
      <div className='text-sm text-muted-foreground'>Open view: {view?.name ?? 'Untitled'}</div>
    </ActivityItemCard>
  );
};

export default ViewSharedActivity;
