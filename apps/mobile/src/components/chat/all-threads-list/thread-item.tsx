import { memo, useCallback, useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useCSSVariable, useUniwind } from 'uniwind';
import { useRouter } from 'expo-router';
import Avatar from '@/src/components/ui/avatar';
import { ConversationComposerMarkdownBody } from '@/src/components/conversation-composer/conversation-composer-markdown-body';
import { buildComposerMarkdownStyle } from '@/src/components/conversation-composer/utils/markdownStyle';
import { useMentionPress } from '@/src/components/conversation-composer/utils/useMentionPress';
import { MessageAttachmentsGrid } from './message-attachments-grid';
import {
  useThreadConversationPreview,
  type MessagePreview,
} from '@/src/hooks/useThreadConversationPreview';
import type { ConversationParticipantRow } from '@/src/utils/threadsSnapshotCache';

type Props = {
  row: ConversationParticipantRow;
  currentUserId: string;
};

// ─── Rich message content using the same markdown pipeline as chat ────────────

const ThreadMessageContent = memo(
  ({ markdown, currentUserId }: { markdown: string; currentUserId?: string }) => {
    const { theme } = useUniwind();
    const foreground = useCSSVariable('--color-foreground') as string;
    const foregroundMuted = useCSSVariable('--color-muted') as string;
    const cardBg = useCSSVariable('--color-card') as string;
    const brand = useCSSVariable('--color-brand') as string;
    const linkColor = theme === 'light' ? '#1B8755' : '#21C063';

    const markdownStyle = useMemo(
      () =>
        buildComposerMarkdownStyle({
          foreground,
          foregroundMuted,
          cardBg,
          brand,
          linkColor,
          variant: 'activity',
        }),
      [foreground, foregroundMuted, cardBg, brand, linkColor],
    );

    const handleMentionPress = useMentionPress();
    const handleLinkPress = useCallback(
      ({ url }: { url: string }) => {
        void handleMentionPress(url);
      },
      [handleMentionPress],
    );

    return (
      <ConversationComposerMarkdownBody
        markdown={markdown}
        markdownStyle={markdownStyle}
        {...(currentUserId ? { currentUserId } : {})}
        isOwnMessage={false}
        selectable={false}
        collapsedNumberOfLines={2}
        onLinkPress={handleLinkPress}
      />
    );
  },
);
ThreadMessageContent.displayName = 'ThreadMessageContent';

// ─── Single message row ───────────────────────────────────────────────────────

const MessageRow = memo(
  ({
    msg,
    currentUserId,
    conversationId,
  }: {
    msg: MessagePreview;
    currentUserId: string;
    conversationId: string;
  }) => (
    <View className='flex-row gap-2 my-2'>
      <Avatar userIds={[msg.senderId]} size={34} />
      <View className='flex-1'>
        <View className='flex-row items-baseline gap-2'>
          <Text className='text-[15px] font-bold text-foreground' numberOfLines={1}>
            {msg.senderName}
          </Text>
          <Text className='text-xs text-foreground/65'>{msg.formattedTime}</Text>
        </View>
        {msg.text.trim().length > 0 && (
          <ThreadMessageContent markdown={msg.text} currentUserId={currentUserId} />
        )}
        {msg.attachments.length > 0 && (
          <MessageAttachmentsGrid attachments={msg.attachments} conversationId={conversationId} />
        )}
      </View>
    </View>
  ),
);
MessageRow.displayName = 'MessageRow';

// ─── Skeleton ─────────────────────────────────────────────────────────────────

const ThreadItemSkeleton = () => (
  <View className='px-4 py-3 border-b border-muted/10'>
    <View className='h-4 w-24 bg-muted/20 rounded mb-3' />
    <View className='flex-row gap-2'>
      <View className='w-7 h-7 rounded-full bg-muted/20' />
      <View className='flex-1 gap-1.5'>
        <View className='h-3 w-32 bg-muted/20 rounded' />
        <View className='h-3 w-full bg-muted/20 rounded' />
        <View className='h-3 w-3/4 bg-muted/20 rounded' />
      </View>
    </View>
  </View>
);

// ─── Main item ────────────────────────────────────────────────────────────────

export const ThreadItem = memo(({ row, currentUserId }: Props) => {
  const router = useRouter();
  const preview = useThreadConversationPreview(row.conversationId, row.channelId, currentUserId);

  const handleReply = useCallback(() => {
    router.push(`/chat/${preview.channelId}/${preview.conversationId}`);
  }, [router, preview.channelId, preview.conversationId]);

  if (preview.isLoading) {
    return <ThreadItemSkeleton />;
  }

  // useChannelDisplayName returns bare name for DEFAULT channels (no # prefix)
  const headerTitle =
    preview.scopeType === 'DEFAULT' && !preview.headerTitle.startsWith('#')
      ? `#${preview.headerTitle}`
      : preview.headerTitle;

  return (
    <View className='px-4 py-3 border-y-[0.5px] border-muted/20 my-2 bg-primary-bg'>
      {/* Channel / DM header */}
      <Text className='text-base font-bold text-foreground' numberOfLines={1}>
        {headerTitle}
      </Text>

      {/* Original / root message */}
      {preview.initialMessage && (
        <MessageRow
          msg={preview.initialMessage}
          currentUserId={currentUserId}
          conversationId={preview.conversationId}
        />
      )}

      {/* "X more replies" — tappable, routes to thread */}
      {preview.moreRepliesCount > 0 && (
        <Pressable
          onPress={handleReply}
          className='flex-row items-center gap-2 self-stretch rounded-lg px-5 py-2 active:bg-muted/20'
          accessibilityRole='button'
          accessibilityLabel={`${preview.moreRepliesCount} more ${preview.moreRepliesCount === 1 ? 'reply' : 'replies'}`}
        >
          <Text className='text-sm font-semibold text-chat-mention-text'>
            {preview.moreRepliesCount}{' '}
            {preview.moreRepliesCount === 1 ? 'more reply' : 'more replies'}
          </Text>
        </Pressable>
      )}

      {/* Last N replies */}
      {preview.lastReplies.map(reply => (
        <MessageRow
          key={reply.messageId}
          msg={reply}
          currentUserId={currentUserId}
          conversationId={preview.conversationId}
        />
      ))}

      {/* Reply CTA */}
      <Pressable
        onPress={handleReply}
        className='mt-3 self-start border border-muted/30 rounded-lg px-4 py-1.5'
        accessibilityRole='button'
        accessibilityLabel='Reply to thread'
      >
        <Text className='text-sm text-foreground'>Reply</Text>
      </Pressable>
    </View>
  );
});
ThreadItem.displayName = 'ThreadItem';
