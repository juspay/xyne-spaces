import { ReactElement } from 'react';
import { CallType } from '@xyne/shared';
import type { ActivityWithRelated } from '../../types/activity';
import { Share01 } from '@xyne/icons';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';

/**
 * Share and access-revocation activities for a recording or a regular call.
 */
export const RecordingSharedActivity = ({
  activity,
  isExpanded,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const call = activity.call;
  const actorId = activity.actorId ?? '';
  const sender = useUser(actorId);

  if (!activity.callId || !call) return null;

  const isRevoked = activity.actorAction === 'recording_access_revoked';
  const isRecording = call.callType === CallType.HEADLESS;
  const subject = isRecording ? 'recording' : 'call';
  const targetPath = isRecording ? `/recordings/${call.externalId}` : `/calls/${call.id}/detail`;

  return (
    <ActivityItemCard
      activity={activity}
      actorId={sender?.id ?? actorId}
      actorName={getUserDisplayName(sender)}
      channelId={activity.channelId ?? undefined}
      badgeIcon={<Share01 className='size-3 text-primary' />}
      badgeColorClass='bg-muted'
      description={
        <span className='text-muted-foreground text-sm'>
          {isRevoked ? `removed your access to a ${subject}` : `shared a ${subject} with you`}
        </span>
      }
      targetPath={targetPath}
      isExpanded={isExpanded}
      className='flex items-start'
    >
      <div className='text-muted-foreground text-sm'>
        {isExpanded
          ? `${isRecording ? 'Recording' : 'Call'}: ${call.title ?? 'Untitled'}`
          : `View ${subject}: ${call.title ?? 'Untitled'}`}
      </div>
    </ActivityItemCard>
  );
};
