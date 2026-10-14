import { memo, useCallback, useMemo, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useCSSVariable } from 'uniwind';

import { useConversationComposer } from './conversation-composer-context';
import { ConversationComposerMarkdownBody } from './conversation-composer-markdown-body';
import { buildComposerMarkdownStyle } from './utils/markdownStyle';
import { DebugBoundary } from './utils/debug-boundary';
import { cn } from '@/src/utils/cn';
import { useChatRenderTokens } from '@/src/features/chat/v2/components/chat/message-row';
import { getParentMessagePreviewText } from '@/src/utils/conversationMessageHelpers';
import { getParentMessagePreviewMarkdown } from './utils/htmlToMD';
import { hasCustomEmojiInMarkdown } from './utils/parseCustomEmojiMarkdownSegments';

type RepliedToThreadProps = {
  className?: string;
};

const RepliedToThread = memo(({ className }: RepliedToThreadProps): ReactElement | null => {
  const { summary, parentMessage, kind, item, currentUser, allowInlineEmojiHydration } =
    useConversationComposer();
  const router = useRouter();
  const {
    embeddedBgUser,
    embeddedMutedUser,
    embeddedTitleUser,
    foregroundMuted,
    cardBg,
    brand,
    linkColor,
    linkColorUser,
    rootTextOther,
    rootTextUser,
  } = useChatRenderTokens();
  const forwardedBgOther = useCSSVariable(
    '--color-conversation-composer-forwarded-bg-other',
  ) as string;
  const isOwnMessage = kind === 'CURRENT_USER';
  const backgroundColor = isOwnMessage ? embeddedBgUser : forwardedBgOther;

  const threadId = parentMessage?.conversationId ?? undefined;

  const preview = useMemo(() => getParentMessagePreviewText(parentMessage), [parentMessage]);
  const previewMarkdown = useMemo(
    () => getParentMessagePreviewMarkdown(parentMessage),
    [parentMessage],
  );
  const hasCustomEmoji = hasCustomEmojiInMarkdown(previewMarkdown);
  const previewMarkdownStyle = useMemo(
    () =>
      buildComposerMarkdownStyle({
        foreground: isOwnMessage ? rootTextUser : rootTextOther,
        foregroundMuted,
        cardBg,
        brand,
        linkColor: isOwnMessage ? linkColorUser : linkColor,
        variant: 'compactActivity',
      }),
    [
      brand,
      cardBg,
      foregroundMuted,
      isOwnMessage,
      linkColor,
      linkColorUser,
      rootTextOther,
      rootTextUser,
    ],
  );

  const openThread = useCallback((): void => {
    const targetMessageId = parentMessage?.messageId;
    if (!threadId || !item.channelId) return;
    router.push({
      pathname: '/chat/[channelId]/[threadId]',
      params: {
        channelId: item.channelId,
        threadId,
        from: 'channel_thread',
        openStartedAtMs: String(Date.now()),
        ...(targetMessageId ? { messageId: targetMessageId } : {}),
      },
    });
  }, [item.channelId, parentMessage?.messageId, router, threadId]);

  if (!summary?.showInChannel) return null;
  if (!parentMessage || !threadId) return null;

  return (
    <DebugBoundary>
      <Pressable
        onPress={openThread}
        accessibilityRole='button'
        accessibilityLabel={`Replied to thread, ${preview}`}
        className={cn('mb-2 rounded-md px-2 py-1.5 active:opacity-90', className)}
        style={{ backgroundColor }}
      >
        <View className='w-full flex-col gap-1'>
          <Text
            className={cn('font-medium text-xs', isOwnMessage ? '' : 'text-foreground')}
            style={isOwnMessage ? { color: embeddedMutedUser } : undefined}
            numberOfLines={1}
          >
            Replied to thread:{' '}
          </Text>
          {hasCustomEmoji ? (
            <ConversationComposerMarkdownBody
              markdown={previewMarkdown}
              markdownStyle={previewMarkdownStyle}
              {...(currentUser?.id ? { currentUserId: currentUser.id } : {})}
              isOwnMessage={isOwnMessage}
              hydrateInlineEmoji={allowInlineEmojiHydration}
              collapsedNumberOfLines={2}
            />
          ) : (
            <Text
              className={cn('font-medium text-xs', isOwnMessage ? '' : 'text-tertiary')}
              style={isOwnMessage ? { color: embeddedTitleUser } : undefined}
              numberOfLines={2}
              ellipsizeMode='tail'
            >
              {preview}
            </Text>
          )}
        </View>
      </Pressable>
    </DebugBoundary>
  );
});
RepliedToThread.displayName = 'ConversationComposer.RepliedToThread';

export { RepliedToThread };
