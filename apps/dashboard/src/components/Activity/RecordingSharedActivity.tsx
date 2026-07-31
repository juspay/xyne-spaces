import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { Share01 } from '@xyne/icons';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';

/**
 * Renders a recording-shared or recording-access-revoked activity for
 * NOTE_TAKER (headless call) recordings, created by
 * EntityAccessSideEffectHandler when a recording is shared/unshared directly
 * with a user or a user group:
 * - recording_shared: "X shared a recording with you"
 * - recording_access_revoked: "X removed your access to a recording"
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
  // Recordings detail is a top-level route (not nested under the activity
  // panel's baseRoute), so this must be an absolute path — see ScheduledCallActivity.
  const targetPath = `/recordings/${call.externalId}`;

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
          {isRevoked ? 'removed your access to a recording' : 'shared a recording with you'}
        </span>
      }
      targetPath={targetPath}
      isExpanded={isExpanded}
      className='flex items-start'
    >
      <div className='text-muted-foreground text-sm'>
        {isExpanded
          ? `Recording: ${call.title ?? 'Untitled'}`
          : `View recording: ${call.title ?? 'Untitled'}`}
      </div>
    </ActivityItemCard>
  );
};
