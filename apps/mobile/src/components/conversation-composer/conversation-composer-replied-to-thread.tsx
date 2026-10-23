import { memo, useCallback, useMemo, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useCSSVariable } from 'uniwind';

import { useConversationComposer } from './conversation-composer-context';
import { ConversationComposerMarkdownBody } from './conversation-composer-markdown-body';
import { buildComposerMarkdownStyle } from './utils/markdownStyle';
import { hasCustomEmojiInMarkdown } from './utils/parseCustomEmojiMarkdownSegments';
import { DebugBoundary } from './utils/debug-boundary';
import { cn } from '@/src/utils/cn';
import { getParentMessagePreviewText } from '@/src/utils/conversationMessageHelpers';
import { getParentMessagePreviewMarkdown } from '@/src/features/chat/v2/components/conversation-composer/utils/htmlToMD';

type RepliedToThreadProps = {
  className?: string;
};

const RepliedToThread = memo(({ className }: RepliedToThreadProps): ReactElement | null => {
  const { summary, parentMessage, kind, item, currentUser } = useConversationComposer();
  const router = useRouter();
  const forwardedBgUser = useCSSVariable(
    '--color-conversation-composer-forwarded-bg-user',
  ) as string;
  const forwardedBgOther = useCSSVariable(
    '--color-conversation-composer-forwarded-bg-other',
  ) as string;
  const isOwnMessage = kind === 'CURRENT_USER';
  const backgroundColor = isOwnMessage ? forwardedBgUser : forwardedBgOther;
  const foreground = useCSSVariable('--color-foreground') as string;
  const foregroundMuted = useCSSVariable('--color-muted') as string;
  const cardBg = useCSSVariable('--color-card') as string;
  const brand = useCSSVariable('--color-brand') as string;
  const linkColor = useCSSVariable('--color-link') as string;

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
        foreground,
        foregroundMuted,
        cardBg,
        brand,
        linkColor,
        variant: 'activity',
      }),
    [brand, cardBg, foreground, foregroundMuted, linkColor],
  );

  const openThread = useCallback((): void => {
    if (!threadId || !item.channelId) return;
    router.push({
      pathname: '/chat/[channelId]/[threadId]',
      params: {
        channelId: item.channelId,
        threadId,
        ...(summary?.messageId ? { messageId: summary.messageId } : {}),
      },
    });
  }, [router, threadId, item.channelId, summary?.messageId]);

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
            className={cn(
              'font-medium text-xs',
              isOwnMessage ? 'text-[#798879]' : 'text-foreground',
            )}
          >
            Replied to thread:{' '}
          </Text>
          {hasCustomEmoji ? (
            <ConversationComposerMarkdownBody
              markdown={previewMarkdown}
              markdownStyle={previewMarkdownStyle}
              {...(currentUser?.id ? { currentUserId: currentUser.id } : {})}
              isOwnMessage={isOwnMessage}
              collapsedNumberOfLines={2}
            />
          ) : (
            <Text
              className={cn(
                'font-medium text-xs',
                isOwnMessage ? 'text-conversation-input-text' : 'text-tertiary',
              )}
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
