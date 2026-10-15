import { memo, useMemo, type ReactElement } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { KeyboardController } from 'react-native-keyboard-controller';

import { ConversationComposer, useConversationComposer } from './conversation-composer';
import type { ConversationItem } from './conversation-composer.types';
import { ChannelScopeType, parseTicketMd, User } from '@xyne/shared';
import { cn } from '@/src/utils/cn';
import { reactionsMdToRawReactions } from '@/src/utils/conversationMessageHelpers';
import { DebugBoundary } from './utils/debug-boundary';
import type { ChatPaintRow } from '@/src/features/chat/paint/chatPaint.types';
import { chatOpenProfiler } from '@/src/features/chat/chatOpenProfiler';

const hasAnyAttachment = (item: ConversationItem): boolean =>
  (item.initialMessageAttachments ?? []).length > 0;

type ChatComposerProps = {
  conversation: ConversationItem;
  currentUser: User | undefined;
  channelType?: ChannelScopeType;
  onLongPress?: (conversation: ConversationItem) => void;
  paintRow?: ChatPaintRow;
  allowMediaHydration?: boolean;
};

const ChatComposerInner = (): ReactElement => {
  chatOpenProfiler.count('chat_composer_inner_render');
  const { kind, item, paintRow, parentMessage } = useConversationComposer();
  const isCurrentUser = kind === 'CURRENT_USER';
  const bubbleBg = isCurrentUser
    ? 'bg-conversation-composer-root-bg-user'
    : 'bg-conversation-composer-root-bg-other';
  const bubbleShadow = isCurrentUser
    ? 'light:shadow-[0px_1px_0.25px_0px_rgba(11,20,26,0.06)] dark:shadow-none'
    : 'light:shadow-[0px_1px_0.5px_0px_rgba(11,20,26,0.06)] dark:shadow-[0px_1px_0.5px_0px_rgba(11,20,26,0.13)]';

  const replyCount = parentMessage ? 0 : (paintRow?.replyCount ?? item.replyCount ?? 0);
  const hasTicket = !!paintRow?.ticketPreview || !!parseTicketMd(item.ticket_md ?? null);
  const hasAttachments = hasAnyAttachment(item);
  const showBorderTop = replyCount > 0 && !hasTicket && !hasAttachments;

  return (
    <View
      className={cn(
        'max-w-[78%] rounded-xl px-2 py-1.5',
        bubbleBg,
        bubbleShadow,
        // Clip attachment media/backgrounds to the bubble's rounded corners. Only
        // on Android: it uses elevation for the shadow (unaffected by clipping),
        // whereas iOS draws the shadow outside bounds and `overflow-hidden` would
        // clip it away. iOS already clips children to the radius correctly.
        Platform.OS === 'android' && 'overflow-hidden',
      )}
    >
      <ConversationComposer.UserDetails className='mb-2' />
      <ConversationComposer.RepliedToThread />
      <ConversationComposer.Forwarded className='mb-2.5' />
      <ConversationComposer.Content />
      <ConversationComposer.Ticket className='mb-2.5' />
      <ConversationComposer.Attachments />

      <DebugBoundary>
        <View
          className={cn(
            'flex-row items-end gap-1',
            showBorderTop ? 'pt-2 border-t border-border' : '',
          )}
        >
          <ConversationComposer.Replies />
          <View className='flex-1' />
          <ConversationComposer.Edited />
          <ConversationComposer.Bookmarked />
          <ConversationComposer.Pinned />
          <ConversationComposer.Timestamp />
        </View>
      </DebugBoundary>
      <ConversationComposer.Reactions />
    </View>
  );
};

type ChatComposerPressableProps = {
  onLongPress?: (conversation: ConversationItem) => void;
};

const ChatComposerPressable = ({ onLongPress }: ChatComposerPressableProps): ReactElement => {
  chatOpenProfiler.count('chat_composer_pressable_render');
  const { item, kind, summary, paintRow } = useConversationComposer();
  const router = useRouter();
  const resolvedTicketId = item.ticketId || parseTicketMd(item.ticket_md ?? null)?.id || '';
  const isPressableKind = kind === 'CURRENT_USER' || kind === 'OTHER_USER' || kind === 'TICKET';

  const hasReactions = useMemo(() => {
    if (typeof paintRow?.reactionSummaryCount === 'number') {
      return paintRow.reactionSummaryCount > 0;
    }
    const messageId = summary?.messageId;
    if (!messageId) return false;
    return reactionsMdToRawReactions(summary?.reactions_md ?? null, messageId).length > 0;
  }, [paintRow?.reactionSummaryCount, summary?.messageId, summary?.reactions_md]);

  const handlePress = (): void => {
    if (KeyboardController.isVisible()) {
      void KeyboardController.dismiss();
      return;
    }
    if (resolvedTicketId) {
      router.push({
        pathname: '/ticket/[ticketId]',
        params: { ticketId: resolvedTicketId },
      });
      return;
    }
    router.push({
      pathname: '/chat/[channelId]/[threadId]',
      params: { channelId: item.channelId, threadId: item.conversationId },
    });
  };

  const handleLongPress = onLongPress ? (): void => onLongPress(item) : undefined;

  if (kind === 'SYSTEM') {
    return (
      <View className='py-1 flex-row justify-center'>
        <ConversationComposer.SystemMessage />
      </View>
    );
  }

  const justify = kind === 'CURRENT_USER' ? 'justify-end' : 'justify-start';

  return (
    <Pressable
      className={cn('py-1 flex-row items-end gap-2', justify, hasReactions && 'pb-[22px]')}
      onPress={isPressableKind ? handlePress : undefined}
      onLongPress={handleLongPress}
      disabled={!isPressableKind && !onLongPress}
      style={({ pressed }) => (pressed && isPressableKind ? { opacity: 0.7 } : null)}
    >
      <ConversationComposer.Avatar />
      <ChatComposerInner />
    </Pressable>
  );
};

const ChatComposerComponent = ({
  conversation,
  currentUser,
  channelType,
  onLongPress,
  paintRow,
  allowMediaHydration = true,
}: ChatComposerProps): ReactElement => {
  chatOpenProfiler.count('chat_composer_render');
  chatOpenProfiler.count(`chat_composer_row_type_${paintRow?.rowType ?? 'unknown'}`);

  return (
    <ConversationComposer.Root
      item={conversation}
      currentUser={currentUser}
      allowMediaHydration={allowMediaHydration}
      {...(channelType !== undefined ? { channelType } : {})}
      {...(paintRow ? { paintRow } : {})}
    >
      <ChatComposerPressable {...(onLongPress !== undefined ? { onLongPress } : {})} />
    </ConversationComposer.Root>
  );
};

const ChatComposer = memo(ChatComposerComponent);
ChatComposer.displayName = 'ChatComposer';

export { ChatComposer };
