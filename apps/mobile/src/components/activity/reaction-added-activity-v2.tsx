import { memo, type ReactElement } from 'react';
import { View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { parseReactionsMd, getMostRecentEmoji, type ReactionsData } from '@xyne/shared';
import { useSelf } from '@/src/hooks/useUsers';
import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';
import { ActivityV2Card } from './activity-v2-card';
import { ActivityV2MessageContent } from './activity-v2-message-content';
import type { ActivityV2Props } from './activity-v2/activity-v2.types';

export const ReactionAddedActivityV2 = memo(
  ({ activity }: ActivityV2Props): ReactElement | null => {
    const currentUser = useSelf();
    const reactionBadgeBg = useCSSVariable('--color-activity-v2-reaction-badge-bg') as string;
    const message = activity.message;
    if (!message || !message.conversation) return null;

    const reactionsData: ReactionsData = parseReactionsMd(message.reactions_md);
    const latestEmoji = getMostRecentEmoji(reactionsData);
    if (!latestEmoji) return null;

    const emojiNames = Object.keys(reactionsData);
    const uniqueReactors = new Set(emojiNames.flatMap(name => reactionsData[name] ?? []));
    if (activity.userId) uniqueReactors.delete(activity.userId);
    const uniqueReactorCount = uniqueReactors.size;

    let description: string;
    if (activity.actorAction === 'removed_v2') {
      description = 'removed reaction from your message in';
    } else if (uniqueReactorCount <= 1) {
      description = 'reacted to your message in';
    } else if (uniqueReactorCount === 2) {
      description = 'and 1 other reacted to your message in';
    } else {
      description = `and ${uniqueReactorCount - 1} others reacted to your message in`;
    }

    return (
      <ActivityV2Card
        activity={activity}
        badgeIcon={
          <View className='items-center justify-center'>
            <ReactionEmojiDisplay emojiName={latestEmoji} size={12} />
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
  },
);
ReactionAddedActivityV2.displayName = 'ReactionAddedActivityV2';
