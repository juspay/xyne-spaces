import { memo, type ReactElement } from 'react';
import { AtSign } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { useSelf } from '@/src/hooks/useUsers';
import { ActivityV2Card } from './activity-v2-card';
import { ActivityV2MessageContent } from './activity-v2-message-content';
import type { ActivityV2Props } from './activity-v2/activity-v2.types';

export const MessageMentionActivity = memo(({ activity }: ActivityV2Props): ReactElement | null => {
  const currentUser = useSelf();
  const mentionBadgeBg = useCSSVariable('--color-activity-v2-user-mention-badge-bg') as string;
  const mentionBadgeStroke = useCSSVariable(
    '--color-activity-v2-user-mention-badge-text',
  ) as string;
  const message = activity.message;
  if (!message || !message.conversation) return null;

  return (
    <ActivityV2Card
      activity={activity}
      badgeIcon={<AtSign size={12} color={mentionBadgeStroke} />}
      badgeStyle={{ backgroundColor: mentionBadgeBg }}
      description='mentioned you in'
    >
      <ActivityV2MessageContent
        message={message}
        currentUser={currentUser}
        isUnread={!activity.isRead}
      />
    </ActivityV2Card>
  );
});
MessageMentionActivity.displayName = 'MessageMentionActivity';
