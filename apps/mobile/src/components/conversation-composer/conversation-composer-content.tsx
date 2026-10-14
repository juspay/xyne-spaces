import { memo, useMemo, useState, type ReactElement } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { useCSSVariable, useUniwind } from 'uniwind';

import { useConversationComposer } from './conversation-composer-context';
import { ConversationComposerMarkdownBody } from './conversation-composer-markdown-body';
import { htmlToMD, normalizeActivityPreviewMarkdown } from './utils/htmlToMD';
import { buildComposerMarkdownStyle } from './utils/markdownStyle';
import { useMentionPress } from './utils/useMentionPress';
import { DebugBoundary } from './utils/debug-boundary';
import {
  getLongMessageCollapseModel,
  shouldCollapseMessageBody,
} from './utils/longMessageCollapse';
import { MessageType } from '@xyne/shared';
import { chatOpenProfiler } from '@/src/features/chat/chatOpenProfiler';

const READ_MORE_VERTICAL_GAP = 4;

const Content = memo((): ReactElement | null => {
  chatOpenProfiler.count('conversation_content_render');
  const { item, kind, summary, forwarded, currentUser, contentVariant } = useConversationComposer();
  const { theme } = useUniwind();
  const [expandedConversationId, setExpandedConversationId] = useState<string | null>(null);

  const foreground = useCSSVariable(
    contentVariant === 'activity' ? '--color-activity-description' : '--color-foreground',
  ) as string;
  const foregroundMuted = useCSSVariable(
    contentVariant === 'activity' ? '--color-activity-description' : '--color-muted',
  ) as string;
  const cardBg = useCSSVariable('--color-card') as string;
  const brand = useCSSVariable('--color-brand') as string;
  const linkColor = theme === 'light' ? '#1B8755' : '#21C063';
  const handleMentionPress = useMentionPress();

  const rawHtml = !summary
    ? ''
    : summary.msgType === MessageType.FORWARDED
      ? (forwarded?.optionalText ?? '')
      : summary.content;
  const markdown = useMemo(() => htmlToMD(rawHtml), [rawHtml]);

  // Pixel maxWidth so the native markdown component clamps unbreakable inline runs
  // (mention links, custom emoji) instead of inflating the bubble's intrinsic width.
  // Mirrors `max-w-[78%] p-1.5` on the bubble in chat-composer.tsx.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const markdownMaxWidth = Math.max(120, windowWidth * 0.78 - 12);

  const markdownStyle = useMemo(
    () =>
      buildComposerMarkdownStyle({
        foreground,
        foregroundMuted,
        cardBg,
        brand,
        linkColor,
        variant: contentVariant,
      }),
    [foreground, foregroundMuted, cardBg, brand, linkColor, contentVariant],
  );

  // Compute markdown before any early return. Custom emojis stay as `xemoji:...`
  // placeholders - `ConversationComposerMarkdownBody` resolves and renders them.
  const previewMarkdown = useMemo(() => {
    return contentVariant === 'activity' ? normalizeActivityPreviewMarkdown(markdown) : markdown;
  }, [contentVariant, markdown]);

  const longMessage = useMemo(
    () =>
      getLongMessageCollapseModel({
        markdown: previewMarkdown,
        maxWidth: markdownMaxWidth,
        viewportHeight: windowHeight,
      }),
    [previewMarkdown, markdownMaxWidth, windowHeight],
  );

  if (kind === 'TICKET') return null;
  if (!summary) return null;
  if (summary.visibleTo && summary.visibleTo !== currentUser?.id) return null;
  if (!previewMarkdown.trim()) return null;

  const isExpanded = expandedConversationId === item.conversationId;
  const canCollapse = contentVariant === 'primary' && shouldCollapseMessageBody(longMessage, kind);
  const isCollapsed = canCollapse && !isExpanded;

  const markdownEl = (
    <View>
      <ConversationComposerMarkdownBody
        markdown={previewMarkdown}
        markdownStyle={markdownStyle}
        containerStyle={{ maxWidth: markdownMaxWidth }}
        onLinkPress={({ url }) => {
          void handleMentionPress(url);
        }}
        selectable={false}
        {...(currentUser?.id ? { currentUserId: currentUser.id } : {})}
        isOwnMessage={kind === 'CURRENT_USER'}
        {...(isCollapsed ? { collapsedNumberOfLines: longMessage.collapsedNumberOfLines } : {})}
      />
      {isCollapsed ? (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Read more'
          hitSlop={8}
          onPress={() => setExpandedConversationId(item.conversationId)}
          className='self-start'
          style={{ paddingTop: READ_MORE_VERTICAL_GAP, paddingBottom: READ_MORE_VERTICAL_GAP }}
        >
          <Text style={{ color: linkColor, fontSize: 15, lineHeight: 20, fontWeight: '600' }}>
            Read more
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  if (kind === 'SYSTEM') {
    return (
      <DebugBoundary>
        <View className='bg-conversation-composer-root-bg-other rounded-md px-2 py-1'>
          {markdownEl}
        </View>
      </DebugBoundary>
    );
  }

  return (
    <DebugBoundary>
      <View className='mb-2.5'>{markdownEl}</View>
    </DebugBoundary>
  );
});
Content.displayName = 'ConversationComposer.Content';

export { Content };
