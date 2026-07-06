import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { Share2 } from 'lucide-react';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { useRouteContext } from '../../hooks/useRouteContext';

/**
 * Renders a canvas sharing, role change, or access revoked activity:
 * - canvas_shared: "X shared 'Canvas Name' with you"
 * - canvas_role_changed: "X changed your role on 'Canvas Name'"
 * - canvas_access_revoked: "X revoked your access to 'Canvas Name'"
 *
 * Note: The specific role (Editor/Viewer/Owner) is not stored on the Activity record.
 * The push notification (via NotificationService) includes role text in its metadata,
 * but the activity feed shows the action without role differentiation.
 */
export const CanvasSharedActivity = ({
  activity,
  isExpanded,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const { baseRoute } = useRouteContext();
  const canvasId = activity.canvasId ?? undefined;
  const canvas = activity.canvas;
  const actorId = activity.actorId ?? canvas?.lastEditedBy ?? '';
  const sender = useUser(actorId);

  if (!canvasId || !canvas) return null;

  const targetPath = `${baseRoute}/canvas/${canvasId}`;

  const isShare = activity.actorAction === 'canvas_shared';
  const isAccessRevoked = activity.actorAction === 'canvas_access_revoked';
  const descriptionText = isAccessRevoked
    ? 'revoked your access to'
    : isShare
      ? 'shared a canvas with you'
      : 'changed your role on';

  return (
    <ActivityItemCard
      activity={activity}
      actorId={sender?.id ?? actorId}
      actorName={getUserDisplayName(sender)}
      channelId={activity.channelId ?? undefined}
      badgeIcon={<Share2 className='w-4 h-4 text-primary' />}
      badgeColorClass='bg-muted'
      description={<span className='text-muted-foreground text-sm'>{descriptionText}</span>}
      targetPath={targetPath}
      isExpanded={isExpanded}
      className='flex items-start'
    >
      <div className='text-muted-foreground text-sm'>
        {isExpanded
          ? `Canvas: ${canvas.title ?? 'Untitled'}`
          : `View canvas: ${canvas.title ?? 'Untitled'}`}
      </div>
    </ActivityItemCard>
  );
};
