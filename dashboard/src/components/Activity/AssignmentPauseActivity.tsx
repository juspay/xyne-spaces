import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { PauseCircle } from 'lucide-react';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';

export const AssignmentPauseActivity = ({
  activity,
  isExpanded,
}: {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}): ReactElement | null => {
  // actionSourceId contains the userId of the user who paused
  const pausedUserId = activity.actionSourceId;
  const pausedUser = useUser(pausedUserId);

  if (!pausedUser) return null;

  const userName = pausedUser.name || pausedUser.email || 'A team member';

  // No target path needed - this is just informational
  const targetPath = '';

  return (
    <ActivityItemCard
      activity={activity}
      actorId={pausedUserId}
      actorName={userName}
      channelId={undefined}
      badgeIcon={<PauseCircle className='w-4 h-4 text-gray-600' />}
      badgeColorClass='bg-gray-100'
      description={<span className='text-gray-500 text-sm'>ticket assignment</span>}
      targetPath={targetPath}
      isExpanded={isExpanded}
      actorAction={activity.actorAction}
    >
      {isExpanded ? (
        <div className='flex flex-col gap-1 mt-2'>
          <div className='text-sm text-[#181B1D] font-medium'>
            {userName} has paused from ticket assignment
          </div>
        </div>
      ) : (
        <span className='text-sm text-[#181B1D]'>
          <span className='font-semibold'>{userName}</span>
          <span className='text-[#505B62]'> paused from ticket assignment</span>
        </span>
      )}
    </ActivityItemCard>
  );
};
