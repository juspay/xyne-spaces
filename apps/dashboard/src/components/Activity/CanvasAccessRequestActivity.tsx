import { ReactElement, useState } from 'react';
import { toast } from 'sonner';
import { ActivityClassification, CanvasRole } from '@xyne/shared';
import { Share01 } from '@xyne/icons';
import type { ActivityWithRelated } from '../../types/activity';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { useRouteContext } from '../../hooks/useRouteContext';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { canvasService } from '../../services/Canvas/canvasService';

/**
 * Owner/editor-facing "X requested edit access to a canvas" activity with
 * inline Approve / Reject. The request's durable state lives on the activity
 * rows themselves: classification ACTIONABLE = open, SKIP = resolved. Both
 * actions call the REST resolve endpoint, which settles the request for
 * EVERY recipient (approve additionally upserts the requester to EDITOR);
 * the granted chip is derived live from the requester's participant row, so
 * it collapses in every recipient's feed.
 */
export const CanvasAccessRequestActivity = ({
  activity,
  isExpanded,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const { baseRoute } = useRouteContext();
  const canvasId = activity.canvasId ?? undefined;
  const requesterId = activity.actorId ?? '';
  const requester = useUser(requesterId);
  // Local flag is only the instant overlay; the durable signal is
  // classification=SKIP written server-side by the resolve endpoint.
  const [locallyRejected, setLocallyRejected] = useState(false);
  const [actingOn, setActingOn] = useState<'approve' | 'reject' | null>(null);
  const [participants] = useCachedQuery(queries.canvasParticipants({ canvasId: canvasId ?? '' }), {
    enabled: !!canvasId,
  });

  if (!canvasId || !activity.canvas) return null;

  const requesterRow = participants?.find(p => p.userId === requesterId);
  const alreadyGranted =
    requesterRow?.role === CanvasRole.EDITOR || requesterRow?.role === CanvasRole.OWNER;
  const rejected = locallyRejected || activity.classification === ActivityClassification.SKIP;

  // Both actions go through REST rather than a Zero mutator: resolving marks
  // every recipient's request row handled, and the activities mutation ACL
  // only lets the server (which created those rows) write across users.
  const resolve = async (action: 'approve' | 'reject'): Promise<void> => {
    if (actingOn) return;
    setActingOn(action);
    try {
      await canvasService.resolveAccessRequest(
        canvasId,
        requesterId,
        action === 'approve' ? 'approve' : 'decline',
      );
      if (action === 'approve') {
        toast.success('Edit access granted', {
          description: `${getUserDisplayName(requester)} can now edit this canvas.`,
        });
      } else {
        setLocallyRejected(true);
      }
    } catch {
      toast.error(action === 'approve' ? 'Failed to grant access' : 'Failed to reject request');
    } finally {
      setActingOn(null);
    }
  };

  const targetPath = `${baseRoute}/canvas/${canvasId}`;

  return (
    <ActivityItemCard
      activity={activity}
      actorId={requesterId}
      actorName={getUserDisplayName(requester)}
      channelId={activity.channelId ?? undefined}
      badgeIcon={<Share01 className='size-3 text-primary' />}
      badgeColorClass='bg-muted'
      description={
        <span className='text-muted-foreground text-sm'>requested edit access to a canvas</span>
      }
      targetPath={targetPath}
      isExpanded={isExpanded}
      className='flex items-start'
      unresolvedChannelLabel='Private channel'
    >
      <div className='flex flex-col gap-2'>
        <div className='text-muted-foreground text-sm'>
          Canvas: {activity.canvas.title ?? 'Untitled'}
        </div>
        {alreadyGranted ? (
          <span className='text-xs font-medium text-green-600'>Edit access granted</span>
        ) : rejected ? (
          <span className='text-xs text-muted-foreground'>Rejected</span>
        ) : (
          <div className='flex items-center gap-2'>
            <button
              type='button'
              disabled={!!actingOn}
              onClick={e => {
                e.stopPropagation();
                void resolve('approve');
              }}
              data-track-category='CANVAS'
              data-track-name='Approve_Edit_Access_Request'
              data-track-metadata={JSON.stringify({ canvasId })}
              className='h-6 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60'
            >
              {actingOn === 'approve' ? 'Approving…' : 'Approve'}
            </button>
            <button
              type='button'
              disabled={!!actingOn}
              onClick={e => {
                e.stopPropagation();
                void resolve('reject');
              }}
              data-track-category='CANVAS'
              data-track-name='Reject_Edit_Access_Request'
              data-track-metadata={JSON.stringify({ canvasId })}
              className='h-6 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60'
            >
              {actingOn === 'reject' ? 'Rejecting…' : 'Reject'}
            </button>
          </div>
        )}
      </div>
    </ActivityItemCard>
  );
};
