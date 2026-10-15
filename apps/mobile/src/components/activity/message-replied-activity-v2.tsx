import { memo, type ReactElement } from 'react';
import { Reply } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';
import { parseRepliesMd, type RepliesData } from '@xyne/shared';
import { useSelf } from '@/src/hooks/useUsers';
import { ActivityV2Card } from './activity-v2-card';
import { ActivityV2MessageContent } from './activity-v2-message-content';
import type { ActivityV2Props } from './activity-v2/activity-v2.types';

export const MessageRepliedActivityV2 = memo(
  ({ activity }: ActivityV2Props): ReactElement | null => {
    const currentUser = useSelf();
    const threadIconColor = useCSSVariable('--color-activity-thread-icon') as string;
    const threadBadgeBg = useCSSVariable('--color-activity-thread-bg') as string;
    const threadBadgeBgUnread = useCSSVariable('--color-activity-thread-bg-unread') as string;
    const message = activity.message;
    if (!message || !message.conversation) return null;
    const isUnread = !activity.isRead;

    const conversation = message.conversation;
    const repliesData: RepliesData = parseRepliesMd(conversation.replies_md);
    if (repliesData.repliers.length === 0) return null;

    const recipientId = activity.userId;
    const isThreadStarter = conversation.createdBy === recipientId;
    const repliers = repliesData.repliers;
    const recipientIndex = recipientId ? repliers.indexOf(recipientId) : -1;
    const hasReplied = recipientIndex >= 0;
    const isRecipientOwner = isThreadStarter || hasReplied;
    const afterRepliers = isThreadStarter
      ? repliers
      : repliers.slice(recipientIndex >= 0 ? recipientIndex + 1 : 0);
    const uniqueAfterRepliers = new Set(afterRepliers);
    if (recipientId) uniqueAfterRepliers.delete(recipientId);
    const uniqueReplierCount = uniqueAfterRepliers.size;

    let description: string;
    if (uniqueReplierCount <= 1) {
      description = isRecipientOwner
        ? 'replied on your message in'
        : "replied in a thread you're following";
    } else if (uniqueReplierCount === 2) {
      description = isRecipientOwner
        ? 'and 1 other replied on your message in'
        : "and 1 other replied in a thread you're following";
    } else {
      description = isRecipientOwner
        ? `and ${uniqueReplierCount - 1} others replied on your message in`
        : `and ${uniqueReplierCount - 1} others replied in a thread you're following`;
    }

    return (
      <ActivityV2Card
        activity={activity}
        badgeIcon={<Reply size={12} color={threadIconColor} />}
        badgeStyle={{ backgroundColor: isUnread ? threadBadgeBgUnread : threadBadgeBg }}
        description={description}
      >
        <ActivityV2MessageContent
          message={message}
          currentUser={currentUser}
          isUnread={!activity.isRead}
        />
      </ActivityV2Card>
    );
  },
);
MessageRepliedActivityV2.displayName = 'MessageRepliedActivityV2';
