import { memo } from 'react';
import { Text, View } from 'react-native';

import { ChatThread } from '@/src/features/chat/v2/components/chat/chat-thread';

type MessagesTabProps = {
  channelId: string;
  conversationId: string | null;
  isMember: boolean;
  contentPaddingTop: number;
  /** Tapping the parent ticket card stays on this screen and opens Details. */
  onParentTicketPress: () => void;
};

export const MessagesTab = memo(function MessagesTab({
  channelId,
  conversationId,
  isMember,
  contentPaddingTop,
  onParentTicketPress,
}: MessagesTabProps) {
  if (!conversationId) {
    return (
      <View style={{ paddingTop: contentPaddingTop }} className='flex-1 items-center px-6 pt-10'>
        <Text className='text-center text-[15px] text-secondary-foreground'>
          No conversation linked to this ticket
        </Text>
      </View>
    );
  }

  if (!isMember) {
    return (
      <View style={{ paddingTop: contentPaddingTop }} className='flex-1 items-center px-6 pt-10'>
        <Text className='text-center text-[15px] text-secondary-foreground'>
          Join this desk to view messages
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, paddingTop: contentPaddingTop }}>
      <ChatThread
        channelId={channelId}
        threadId={conversationId}
        composerInsetMode='screen'
        onParentTicketPress={onParentTicketPress}
        hideHeader
      />
    </View>
  );
});
