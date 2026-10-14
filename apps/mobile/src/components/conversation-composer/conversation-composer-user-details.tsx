import { memo, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChannelScopeType, parseTicketMd } from '@xyne/shared';

import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';
import { useConversationComposer } from './conversation-composer-context';
import { useUser } from '@/src/hooks/useUsers';
import { useUserColor } from './utils/getUserColor';
import { useOpenUserDm } from './utils/useOpenUserDm';
import { DebugBoundary } from './utils/debug-boundary';
import { cn } from '@/src/utils/cn';
import { getActiveUserStatusEmoji } from '@/src/utils/statusUtils';

type UserDetailsProps = {
  className?: string;
};

const UserDetails = memo(({ className }: UserDetailsProps): ReactElement | null => {
  const { item, summary, kind, channelType, paintRow } = useConversationComposer();
  const senderId = summary?.senderId ?? '';
  const sender = useUser(paintRow ? '' : senderId);
  const statusEmoji = getActiveUserStatusEmoji(sender);
  const color = useUserColor(senderId);
  const { openUserDm, busy } = useOpenUserDm();

  if (channelType === ChannelScopeType.DM) return null;
  if (paintRow?.ticketPreview || parseTicketMd(item.ticket_md ?? null)) return null;
  if (kind !== 'OTHER_USER' && kind !== 'BOT') return null;
  const senderName = paintRow?.senderPaintModel.displayName ?? sender?.name;
  if (!senderName) return null;

  const handlePress = (): void => {
    void openUserDm(senderId);
  };

  return (
    <DebugBoundary>
      <Pressable
        onPress={handlePress}
        disabled={busy || !senderId}
        hitSlop={4}
        style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
      >
        <View className='flex-row items-start gap-1.5  '>
          <Text
            className={cn('text-sm font-semibold shrink min-w-0  ', className)}
            style={{ color }}
            numberOfLines={1}
          >
            {senderName}
          </Text>
          {statusEmoji ? (
            <View className='shrink-0  '>
              <ReactionEmojiDisplay emojiName={statusEmoji} size={18} />
            </View>
          ) : null}
        </View>
      </Pressable>
    </DebugBoundary>
  );
});
UserDetails.displayName = 'ConversationComposer.UserDetails';

export { UserDetails };
