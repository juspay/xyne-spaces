import { ReactElement } from 'react';
import { FolderCheck, CheckCircle2, XCircle } from 'lucide-react';
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

  // Counts are frozen at creation time in blockId as "succeeded,failed" (see
  // collectionIngestionNotifier), so each notification keeps its own numbers.
  // Older rows have no snapshot → fall back to a live rollup.
  const snap = (activity.blockId ?? '').split(',');
  const hasSnap = snap.length === 2 && snap.every(n => /^\d+$/.test(n));

  const [collections] = useCachedQuery(
    queries.collectionById({ id: collectionId }),
    !!collectionId,
  );
  const [files] = useCachedQuery(
    queries.collectionFilesByRoot({ rootCollectionId: collectionId }),
    !hasSnap && !!collectionId,
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

  const targetPath = collectionId ? `/knowledge-base?cl=${collectionId}` : '';

  return (
    <ActivityItemCard
      activity={activity}
      actorId={activity.actorId}
      // System event — the subject is the knowledge base, not the person. (The card
      // always bold-prefixes this label; passing the user's name read as "Om did it".)
      actorName='Knowledge base'
      channelId={undefined}
      badgeIcon={<FolderCheck className='size-3 text-primary' />}
      badgeColorClass='bg-muted'
      description={<span className='text-muted-foreground text-sm'>finished processing files</span>}
      targetPath={targetPath}
      isExpanded={isExpanded}
      actorAction={activity.actorAction}
    >
      {/* The header line truncates, so keep the full, self-explanatory summary
          here — the collapsed row clamps children to one line, so context +
          name + counts stay together on the line that's actually visible. */}
      <div className={isExpanded ? 'text-sm mt-2' : 'text-sm'}>
        <span className='text-muted-foreground'>{'Collection '}</span>
        {collectionName ? (
          <span className='font-medium text-foreground'>{`"${collectionName}" `}</span>
        ) : null}
        {total > 0 ? (
          <span className='ml-1 inline-flex items-center gap-2 align-middle'>
            <span
              title='Succeeded'
              className='inline-flex items-center gap-1 text-muted-foreground'
            >
              <CheckCircle2 className='h-3.5 w-3.5 text-green-600' strokeWidth={2} />
              {succeeded}
            </span>
            <span title='Failed' className='inline-flex items-center gap-1 text-muted-foreground'>
              <XCircle className='h-3.5 w-3.5 text-red-500' strokeWidth={2} />
              {failed}
            </span>
          </span>
        ) : (
          <span className='text-muted-foreground'>· all files processed</span>
        )}
      </div>
    </ActivityItemCard>
  );
};
