import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { PauseCircle, PlayCircle } from 'lucide-react';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName, isUserDeactivated } from '../../utils/userDisplayName';

export const AssignmentPauseActivity = ({
  activity,
  isExpanded,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  const isPaused = activity.actorAction === 'paused_from_assignment';

  // actionSourceId contains the userId of the user who paused/resumed
  const userId = activity.actionSourceId;
  const user = useUser(userId);

  if (!user) return null;

  const userName = getUserDisplayName(user);
  const isDeactivated = isUserDeactivated(user);

  // No target path needed - this is just informational
  const targetPath = '';

  // Determine badge icon and text based on action type
  const badgeIcon = isPaused ? (
    <PauseCircle className='w-4 h-4 text-muted-foreground' />
  ) : (
    <PlayCircle className='w-4 h-4 text-green-600' />
  );

  const badgeColorClass = isPaused ? 'bg-muted' : 'bg-green-100';

  const expandedText = isPaused
    ? `${userName}${isDeactivated ? ' (Deactivated)' : ''} has paused from ticket assignment`
    : `${userName}${isDeactivated ? ' (Deactivated)' : ''} has resumed from ticket assignment`;

  const collapsedSuffix = isPaused
    ? ' paused from ticket assignment'
    : ' resumed from ticket assignment';

  return (
    <ActivityItemCard
      activity={activity}
      actorId={userId}
      actorName={userName}
      channelId={undefined}
      badgeIcon={badgeIcon}
      badgeColorClass={badgeColorClass}
      description={<span className='text-muted-foreground text-sm'>ticket assignment</span>}
      targetPath={targetPath}
      isExpanded={isExpanded}
      actorAction={activity.actorAction}
    >
      {isExpanded ? (
        <div className='flex flex-col gap-1 mt-2'>
          <div className='text-sm text-foreground font-medium'>{expandedText}</div>
        </div>
      ) : (
        <span className='text-sm text-foreground'>
          <span className='font-semibold'>{userName}</span>
          <span className='text-muted-foreground'>{collapsedSuffix}</span>
        </span>
      )}
    </ActivityItemCard>
  );
};
