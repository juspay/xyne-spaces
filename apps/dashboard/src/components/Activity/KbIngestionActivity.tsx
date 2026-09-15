import { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { IngestionStatus } from '@xyne/shared';
import type { ActivityWithRelated } from '../../types/activity';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';

/**
 * Renders the persistent Activity-feed entry created when every file in a
 * knowledge-base collection finishes ingesting. Mirrors the toast: shows the
 * collection name and a succeeded/failed rollup, and deep-links to the
 * collection. The name + counts are resolved live from the collection id the
 * activity stores (the activities table has no free-text field).
 */
export const KbIngestionActivity = ({
  activity,
  isExpanded,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const actor = useUser(activity.actorId);
  const collectionId = activity.actionSourceId ?? '';
  // Every app route lives under /:workspaceId, and the KB route is
  // /:workspaceId/knowledge-base — so the deep link MUST carry the workspace
  // segment (matching the toast's actionUrl), else it binds :workspaceId to
  // "knowledge-base" and renders a broken workspace.
  const { workspaceId } = useParams<{ workspaceId?: string }>();

  // Counts are frozen at creation time in blockId as "succeeded,failed" (see
  // collectionIngestionNotifier), so each notification keeps its own numbers.
  // Older rows have no snapshot → fall back to a live rollup.
  const snap = (activity.blockId ?? '').split(',');
  const hasSnap = snap.length === 2 && snap.every(n => /^\d+$/.test(n));

  const [collections] = useCachedQuery(
    queries.collectionById({ id: collectionId }),
    // Object form required — a bare boolean is ignored by useCachedQuery.
    { enabled: !!collectionId },
  );
  const [files] = useCachedQuery(
    queries.collectionFilesByRoot({ rootCollectionId: collectionId }),
    // Fallback rollup only — skip entirely when a frozen count snapshot exists.
    { enabled: !hasSnap && !!collectionId },
  );

  if (!actor) return null;

  const collectionName = collections?.[0]?.name;

  let succeeded: number;
  let failed: number;
  let total: number;
  if (hasSnap) {
    succeeded = Number(snap[0]);
    failed = Number(snap[1]);
    total = succeeded + failed;
  } else {
    // Live rollup over the collection's current files (legacy rows only).
    total = files?.length ?? 0;
    let f = 0;
    let inFlight = 0;
    for (const file of files ?? []) {
      const s = (file.ingestionStatus ?? '').toUpperCase() as IngestionStatus;
      if (s === IngestionStatus.FAILED) f += 1;
      else if (s === IngestionStatus.PENDING || s === IngestionStatus.PROCESSING) inFlight += 1;
    }
    failed = f;
    succeeded = Math.max(total - failed - inFlight, 0);
  }

  const targetPath =
    collectionId && workspaceId ? `/${workspaceId}/knowledge-base?cl=${collectionId}` : '';

  // Outcome line: a colored status word + a plain-language summary, mirroring the
  // three real end-states of a collection import.
  let statusLabel: string;
  let statusColor: string;
  let summary: string;
  if (failed === 0) {
    statusLabel = 'Complete';
    statusColor = 'text-status-success';
    summary = `${String(succeeded)} file${succeeded === 1 ? '' : 's'} added, no failures`;
  } else if (succeeded === 0) {
    statusLabel = 'Failed';
    statusColor = 'text-status-failure';
    summary = `none of the ${String(total)} file${total === 1 ? '' : 's'} could be added`;
  } else {
    statusLabel = 'Needs attention';
    statusColor = 'text-status-pending';
    summary = `${String(succeeded)} of ${String(total)} files added, ${String(failed)} failed`;
  }

  return (
    <ActivityItemCard
      activity={activity}
      actorId={activity.actorId}
      // System event — the subject is the knowledge base, not the person. (The card
      // always bold-prefixes this label; passing the user's name read as "Om did it".)
      actorName='Knowledge base'
      channelId={undefined}
      // Header reads: Knowledge base · "collection name". The card colors this span
      // per read/unread state, so no explicit color here.
      description={
        collectionName ? (
          <span className='text-sm'>{`· "${collectionName}"`}</span>
        ) : (
          <span className='text-sm' />
        )
      }
      targetPath={targetPath}
      isExpanded={isExpanded}
      actorAction={activity.actorAction}
    >
      {/* Collapsed rows clamp children to one line — keep the whole outcome on it. */}
      <div className={isExpanded ? 'text-sm mt-2' : 'text-sm'}>
        <span className={`font-semibold ${statusColor}`}>{statusLabel}</span>
        <span className='text-muted-foreground'>{` — ${summary}`}</span>
      </div>
    </ActivityItemCard>
  );
};
