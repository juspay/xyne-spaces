import { memo, useCallback, useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
// import { SmilePlus } from 'lucide-react-native';
import { MessageType } from '@xyne/shared';
import { useMessageContext, useSender, getMessageMsgType } from '../message.utils';
import { useReactionsDetailOptional } from './reactions-detail.context';
import { groupReactionsForPill, totalReactionCount, type RawReaction } from './reaction-pill.utils';
import type { MessageSheetTarget } from '@/src/components/chat/message-sheet/message-sheet.types';
import { ReactionEmojiDisplay } from './reaction-emoji-display';
import { cn } from '@/src/utils/cn';

const PILL_EMOJI_SIZE = 12;
// const ADD_ICON_SIZE = 18;
// const ADD_ICON_COLOR = '#9CA3AF';

export const MessageReactionPill = memo(function MessageReactionPill() {
  const { message } = useMessageContext();
  const sender = useSender();
  const detail = useReactionsDetailOptional();

  const msgType = getMessageMsgType(message);
  const messageId = message.initialMessage?.messageId;
  const isOwnMessage = sender?.id === message.currentUserId;

  const reactions = message.initialMessage?.reactions ?? [];
  const raw = reactions as RawReaction[];
  const groups = useMemo(() => groupReactionsForPill(raw), [raw]);
  const totalCount = totalReactionCount(raw);

  const openDetail = useCallback(() => {
    detail?.open(message as MessageSheetTarget);
  }, [detail, message]);

  // const openPicker = useCallback(() => {
  //   detail?.openEmojiPicker(message as MessageSheetTarget);
  // }, [detail, message]);

  if (msgType === MessageType.SYSTEM || !messageId || groups.length === 0) {
    return null;
  }

  return (
    <View className={cn('flex-row flex-wrap items-center', isOwnMessage && '')}>
      <Pressable
        onPress={openDetail}
        onLongPress={e => e.stopPropagation?.()}
        className='flex-row gap-0.5 items-center h-full rounded-full bg-chat-card border border-border px-1.5 py-1'
        style={{
          boxShadow: '0 1px 1px rgba(26, 26, 26, 0.04)',
        }}
        hitSlop={6}
      >
        {groups.slice(0, 4).map(g => (
          <View key={g.emojiName}>
            <ReactionEmojiDisplay emojiName={g.emojiName} size={PILL_EMOJI_SIZE} />
          </View>
        ))}
        {totalCount > 1 && (
          <Text className='ml-1 text-sm font-medium text-chat-card-foreground-muted'>
            {totalCount}
          </Text>
        )}
      </Pressable>

      {/* <Pressable
        onPress={openPicker}
        onLongPress={e => e.stopPropagation?.()}
        className='h-8 w-8 items-center justify-center active:opacity-70'
        hitSlop={8}
        accessibilityRole='button'
        accessibilityLabel='Add reaction'
      >
        <SmilePlus size={ADD_ICON_SIZE} color={ADD_ICON_COLOR} strokeWidth={1.75} />
      </Pressable> */}
    </View>
  );
});
