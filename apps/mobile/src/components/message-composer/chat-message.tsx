import type { ReactElement } from 'react';
import { View } from 'react-native';
import { User } from '@xyne/shared';

import { MessageComposer, useMessageComposer } from './message-composer';
import type { MessageItem } from './message-composer.types';

type ChatMessageProps = {
  message: MessageItem;
  previousMessage?: MessageItem | undefined;
  currentUser: User | undefined;
};

const ChatMessageInner = (): ReactElement | null => {
  const { kind, isContinuation, previousMessage } = useMessageComposer();

  if (kind === 'SYSTEM') return null;

  const isMine = kind === 'CURRENT_USER';
  const justify = isMine ? 'justify-end' : 'justify-start';
  const bubbleBg = isMine
    ? 'bg-conversation-composer-root-bg-user'
    : 'bg-conversation-composer-root-bg-other';
  const marginTop = !previousMessage ? 0 : isContinuation ? 2 : 16;

  return (
    <View className={`flex-row items-end gap-2 ${justify}`} style={{ marginTop }}>
      {!isMine && <MessageComposer.Avatar />}
      <View className={`max-w-[78%] rounded-xl px-2 py-1.5 ${bubbleBg}`}>
        <MessageComposer.UserDetails className='mb-1' />
        <MessageComposer.Deleted />
        <MessageComposer.Forwarded />
        <MessageComposer.Content />
        <MessageComposer.Attachments />
        <MessageComposer.Reactions />
        <View className='flex-row items-end gap-1 mt-1'>
          <View className='flex-1' />
          <MessageComposer.Edited />
          <MessageComposer.Bookmarked />
          <MessageComposer.Pinned />
          <MessageComposer.Timestamp />
        </View>
      </View>
    </View>
  );
};

const ChatMessage = ({ message, previousMessage, currentUser }: ChatMessageProps): ReactElement => (
  <MessageComposer.Root item={message} previousMessage={previousMessage} currentUser={currentUser}>
    <ChatMessageInner />
  </MessageComposer.Root>
);
ChatMessage.displayName = 'ChatMessage';

export { ChatMessage };
