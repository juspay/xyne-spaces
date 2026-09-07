import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { SparkleAi01 } from '@xyne/icons';
import { ActivityItemCard } from './ActivityItemCard';

/**
 * Renders the persistent Activity-feed entry created when a recording's AI
 * summary finishes generating (see noteTakerTranscriptService's
 * recordSummaryReadyActivity). Mirrors the RECORDING_SUMMARY_READY toast: names
 * the recording and deep-links to it. Regenerating a summary reuses the same
 * row, so there is never more than one of these per recording.
 */
export const RecordingSummaryActivity = ({
  activity,
  isExpanded,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const call = activity.call;
  if (!activity.callId || !call) return null;

  const title = call.title ?? 'Untitled';

  return (
    <ActivityItemCard
      activity={activity}
      actorId={activity.actorId}
      // System event — the subject is the recording, not a person. (The card
      // bold-prefixes this label, so the owner's own name would read as if
      // they had done something.)
      actorName='Recording summary'
      channelId={undefined}
      badgeIcon={<SparkleAi01 className='size-3 text-primary' />}
      badgeColorClass='bg-muted'
      description={<span className='text-sm'>{`· "${title}"`}</span>}
      targetPath={`/recordings/${call.externalId}`}
      isExpanded={isExpanded}
      actorAction={activity.actorAction}
      className='flex items-start'
    >
      <div
        className={
          isExpanded ? 'text-muted-foreground text-sm mt-2' : 'text-muted-foreground text-sm'
        }
      >
        Summary is ready to view
      </div>
    </ActivityItemCard>
  );
};
