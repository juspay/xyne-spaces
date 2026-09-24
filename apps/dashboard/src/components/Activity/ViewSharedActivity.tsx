import { ReactElement } from 'react';
import { Share01 } from '@xyne/icons';
import { SavedConfigContextType } from '@xyne/shared';
import type { ActivityWithRelated } from '../../types/activity';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { getUserDisplayName } from '../../utils/userDisplayName';

/**
 * Renders a saved-view sharing or access-revoked activity:
 * - view_shared:         "X shared a view with you"       + "Open view: <name>"
 * - view_access_revoked: "X revoked your access to a view" + "Open view: <name>"
 *
 * The view can live on a board (contextType BOARD → /projects/:projectId/:boardId)
 * or a desk channel (contextType DESK_TICKET → /support/:channelId). For board views
 * we resolve the parent project id so the link opens the right board.
 */
export const ViewSharedActivity = ({
  activity,
  isExpanded,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const view = activity.savedView;
  const actorId = activity.actorId ?? '';
  const sender = useUser(actorId);

  const isBoardView = view?.contextType === SavedConfigContextType.BOARD;
  const [board] = useCachedQuery(queries.getBoardById({ boardId: view?.contextId ?? '' }), {
    enabled: isBoardView && !!view?.contextId,
  });

  if (!view) return null;

  const targetPath = isBoardView
    ? board?.projectId
      ? `/projects/${board.projectId}/${view.contextId}`
      : '/projects'
    : `/support/${view.contextId}`;

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
      isExpanded={isExpanded}
      className='flex items-start'
      unresolvedChannelLabel='Private channel'
    >
      <div className='text-sm text-muted-foreground'>Open view: {view.name ?? 'Untitled'}</div>
    </ActivityItemCard>
  );
};

export default ViewSharedActivity;
