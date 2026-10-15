import { type ReactElement } from 'react';
import { View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { useSelf } from '@/src/hooks/useUsers';
import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';
import { ActivityV2Card } from './activity-v2-card';
import { ActivityV2MessageContent } from './activity-v2-message-content';
import type { ActivityV2Props } from './activity-v2/activity-v2.types';

export const ReactionAddedActivity = ({ activity }: ActivityV2Props): ReactElement | null => {
  const currentUser = useSelf();
  const reactionBadgeBg = useCSSVariable('--color-activity-v2-reaction-badge-bg') as string;
  const reaction = activity.reaction;
  const message = activity.message;
  if (!reaction || !message || !reaction.userId || !message.conversation) return null;

  const description =
    activity.actorAction === 'added'
      ? 'reacted to your message in'
      : 'removed reaction from your message in';

  return (
    <ActivityV2Card
      activity={activity}
      actorId={reaction.userId}
      badgeIcon={
        <View className='items-center justify-center'>
          <ReactionEmojiDisplay emojiName={reaction.emojiName} size={12} />
        </View>
      }
      badgeStyle={{ backgroundColor: reactionBadgeBg }}
      description={description}
    >
      <ActivityV2MessageContent
        message={message}
        currentUser={currentUser}
        isUnread={!activity.isRead}
      />
    </ActivityV2Card>
  );
};
