import { type ReactElement } from 'react';
import { Reply } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { useSelf } from '@/src/hooks/useUsers';
import { ActivityV2Card } from './activity-v2-card';
import { ActivityV2MessageContent } from './activity-v2-message-content';
import type { ActivityV2Props } from './activity-v2/activity-v2.types';

export const MessageRepliedActivity = ({ activity }: ActivityV2Props): ReactElement | null => {
  const currentUser = useSelf();
  const threadIconColor = useCSSVariable('--color-activity-thread-icon') as string;
  const threadBadgeBg = useCSSVariable('--color-activity-thread-bg') as string;
  const threadBadgeBgUnread = useCSSVariable('--color-activity-thread-bg-unread') as string;
  const message = activity.message;
  if (!message || !message.conversation) return null;
  const isUnread = !activity.isRead;

  return (
    <ActivityV2Card
      activity={activity}
      badgeIcon={<Reply size={12} color={threadIconColor} />}
      badgeStyle={{ backgroundColor: isUnread ? threadBadgeBgUnread : threadBadgeBg }}
      description='replied in'
    >
      <ActivityV2MessageContent
        message={message}
        currentUser={currentUser}
        isUnread={!activity.isRead}
      />
    </ActivityV2Card>
  );
};
