import { ReactElement } from 'react';
import { EnvelopeDefault, AlertTriangle } from '@xyne/icons';
import type { ActivityWithRelated } from '../../types/activity';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';

export const EmailFetchActivity = ({
  activity,
  isExpanded,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const isFailure = activity.actorAction === 'email_fetch_failed';
  const actor = useUser(activity.actorId);
  if (!actor) return null;

  const actorName = getUserDisplayName(actor);
  const channelId = activity.channelId ?? undefined;
  const targetPath = channelId ? `/support/${channelId}` : '';

  const badgeIcon = isFailure ? (
    <AlertTriangle className='size-3 text-destructive' />
  ) : (
    <EnvelopeDefault className='size-3 text-primary' />
  );
  const badgeColorClass = isFailure ? 'bg-red-100' : 'bg-muted';

  const description = isFailure ? 'inbox refresh failed' : 'refreshed the inbox';
  const detail = isFailure
    ? 'The connected account may need to be reconnected.'
    : 'New emails have been imported into this inbox.';

  return (
    <ActivityItemCard
      activity={activity}
      actorId={activity.actorId}
      actorName={actorName}
      channelId={channelId}
      badgeIcon={badgeIcon}
      badgeColorClass={badgeColorClass}
      description={<span className='text-muted-foreground text-sm'>{description}</span>}
      targetPath={targetPath}
      isExpanded={isExpanded}
      actorAction={activity.actorAction}
    >
      <div
        className={
          isExpanded ? 'text-sm text-muted-foreground mt-2' : 'text-sm text-muted-foreground'
        }
      >
        {detail}
      </div>
    </ActivityItemCard>
  );
};
