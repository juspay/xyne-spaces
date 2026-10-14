import { type ReactElement } from 'react';
import { Text } from 'react-native';
import { PauseCircle, PlayCircle } from 'lucide-react-native';
import { useUser } from '@/src/hooks/useUsers';
import { ActivityV2Card } from './activity-v2-card';
import type { ActivityV2Props } from './activity-v2/activity-v2.types';

export const AssignmentPauseActivity = ({ activity }: ActivityV2Props): ReactElement | null => {
  const isPaused = activity.actorAction === 'paused_from_assignment';
  const userId = activity.actionSourceId ?? '';
  const user = useUser(userId);
  if (!user) return null;

  const userName = user.name ?? user.email ?? 'Unknown';
  const icon = isPaused ? (
    <PauseCircle size={12} color='#6b7280' />
  ) : (
    <PlayCircle size={12} color='#15603e' />
  );

  return (
    <ActivityV2Card
      activity={activity}
      actorId={userId}
      actorName={userName}
      badgeIcon={icon}
      badgeColorClass={isPaused ? 'bg-card' : 'bg-green-100'}
      description='ticket assignment'
      hideChannel
    >
      <Text
        className='text-[15px] text-activity-description font-medium'
        style={{ lineHeight: 24 }}
        numberOfLines={2}
      >
        {isPaused
          ? `${userName} has paused from ticket assignment`
          : `${userName} has resumed from ticket assignment`}
      </Text>
    </ActivityV2Card>
  );
};
