import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { AtMark } from '@xyne/icons';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { useRouteContext } from '../../hooks/useRouteContext';

/**
 * Renders a canvas mention activity: "X mentioned you in #channel".
 * Mirrors MessageMentionActivity; actor is derived from canvas.lastEditedBy (the person who saved/mentioned).
 */
export const CanvasMentionActivity = ({
  activity,
  isExpanded,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const { baseRoute } = useRouteContext();
  const canvasId = activity.canvasId ?? undefined;
  const canvasBlockId = activity.blockId ?? undefined;
  const canvas = activity.canvas;
  const actorId = activity.actorId ?? canvas?.lastEditedBy ?? '';
  const sender = useUser(actorId);

  if (!canvasId || !canvas) return null;

  const targetPath = `${baseRoute}/canvas/${canvasId}${canvasBlockId ? `?blockId=${encodeURIComponent(canvasBlockId)}` : ''}`;

  return (
    <ActivityItemCard
      activity={activity}
      actorId={sender?.id ?? actorId}
      actorName={getUserDisplayName(sender)}
      channelId={activity.channelId ?? undefined}
      badgeIcon={<AtMark className='size-3 text-primary' />}
      badgeColorClass='bg-muted'
      description={<span className='text-muted-foreground text-sm'>mentioned you in</span>}
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
