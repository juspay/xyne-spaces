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
  const isCommentMention = activity.actionSource === 'canvas_comment';
  const commentThreadId =
    isCommentMention && activity.actionSourceId !== canvasId ? activity.actionSourceId : undefined;

  if (!canvasId || !canvas) return null;

  const canvasParams = new URLSearchParams();
  if (canvasBlockId) canvasParams.set('blockId', canvasBlockId);
  if (commentThreadId) canvasParams.set('commentThreadId', commentThreadId);
  const targetPath = `${baseRoute}/canvas/${canvasId}${
    canvasParams.toString() ? `?${canvasParams.toString()}` : ''
  }`;

  return (
    <ActivityItemCard
      activity={activity}
      actorId={sender?.id ?? actorId}
      actorName={getUserDisplayName(sender)}
      channelId={activity.channelId ?? undefined}
      badgeIcon={<AtMark className='size-3 text-primary' />}
      badgeColorClass='bg-muted'
      description={
        <span className='text-muted-foreground text-sm'>
          {isCommentMention ? 'mentioned you in a comment on' : 'mentioned you in'}
        </span>
      }
      targetPath={targetPath}
      isExpanded={isExpanded}
      className='flex items-start'
    >
      <div className='text-muted-foreground text-sm'>
        {isCommentMention
          ? `Canvas: ${canvas.title ?? 'Untitled'}`
          : isExpanded
            ? `Canvas: ${canvas.title ?? 'Untitled'}`
            : `View canvas: ${canvas.title ?? 'Untitled'}`}
      </div>
    </ActivityItemCard>
  );
};
