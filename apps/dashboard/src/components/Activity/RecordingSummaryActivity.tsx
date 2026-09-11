import { ReactElement } from 'react';
import { CallType } from '@xyne/shared';
import type { ActivityWithRelated } from '../../types/activity';
import { SparkleAi01 } from '@xyne/icons';
import { ActivityItemCard } from './ActivityItemCard';

/**
 * Renders the persistent Activity-feed entry created when a call or recording's
 * AI summary finishes generating (see noteTakerTranscriptService's
 * recordSummaryReadyActivity). Mirrors the RECORDING_SUMMARY_READY toast: names
 * the subject and deep-links to it. Regenerating a summary reuses the same row,
 * so there is never more than one of these per call.
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
  const isRecording = call.callType === CallType.HEADLESS;
  const targetPath = isRecording ? `/recordings/${call.externalId}` : `/calls/${call.id}/detail`;

  return (
    <ActivityItemCard
      activity={activity}
      actorId={activity.actorId}
      // System event — the subject is the recording, not a person. (The card
      // bold-prefixes this label, so the owner's own name would read as if
      // they had done something.)
      actorName={isRecording ? 'Recording summary' : 'Call summary'}
      channelId={undefined}
      badgeIcon={<SparkleAi01 className='size-3 text-primary' />}
      badgeColorClass='bg-muted'
      description={<span className='text-sm'>{`· "${title}"`}</span>}
      targetPath={targetPath}
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
