import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { Share01 } from '@xyne/icons';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';

/** Renders recording share and access-revocation activities. */
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
