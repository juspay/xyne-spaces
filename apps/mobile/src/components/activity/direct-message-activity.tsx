import { memo, type ReactElement } from 'react';
import { MessageCircle } from 'lucide-react-native';
import { useSelf } from '@/src/hooks/useUsers';
import { ActivityV2Card } from './activity-v2-card';
import { ActivityV2MessageContent } from './activity-v2-message-content';
import type { ActivityV2Props } from './activity-v2/activity-v2.types';

export const DirectMessageActivity = memo(({ activity }: ActivityV2Props): ReactElement | null => {
  const currentUser = useSelf();
  const message = activity.message;
  if (!message || !message.conversation) return null;

  return (
    <ActivityV2Card
      activity={activity}
      badgeIcon={<MessageCircle size={12} color='#15603e' />}
      badgeColorClass='bg-green-100'
      description='sent you a DM in'
    >
      <ActivityV2MessageContent
        message={message}
        currentUser={currentUser}
        isUnread={!activity.isRead}
      />
    </ActivityV2Card>
  );
});
DirectMessageActivity.displayName = 'DirectMessageActivity';
