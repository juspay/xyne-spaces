import { ReactElement } from 'react';
import { AlertTriangle } from '@xyne/icons';
import type { ActivityWithRelated } from '../../types/activity';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';

export const DeskAccountDisconnectedActivity = ({
  activity,
  isExpanded,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const actor = useUser(activity.actorId);
  if (!actor) return null;

  const channelId = activity.channelId ?? undefined;
  // No channel means the workspace shared mailbox, which is managed from the same modal.
  const targetPath = `/support${channelId ? `/${channelId}` : ''}?deskIntegrations=open`;

  return (
    <ActivityItemCard
      activity={activity}
      actorId={activity.actorId}
      actorName={getUserDisplayName(actor)}
      channelId={channelId}
      badgeIcon={<AlertTriangle className='size-3 text-destructive' />}
      badgeColorClass='bg-red-100'
      description={
        <span className='text-muted-foreground text-sm'>needs to reconnect a desk account</span>
      }
      targetPath={targetPath}
      isExpanded={isExpanded}
      actorAction={activity.actorAction}
    >
      <div
        className={
          isExpanded ? 'text-sm text-muted-foreground mt-2' : 'text-sm text-muted-foreground'
        }
      >
        A connected account was disconnected. Reconnect it in desk settings to keep receiving and
        sending messages.
      </div>
    </ActivityItemCard>
  );
};
