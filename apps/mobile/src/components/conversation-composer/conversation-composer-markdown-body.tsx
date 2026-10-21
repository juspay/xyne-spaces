import { Image } from 'expo-image';
import { memo, useMemo, type ReactElement } from 'react';
import { Text, View, type ViewStyle } from 'react-native';
import {
  EnrichedMarkdownText,
  type LinkPressEvent,
  type MarkdownStyle,
} from 'react-native-enriched-markdown';

import { useMtlsEmojiUris } from '@/src/hooks/useMtlsEmoji';
import {
  extractFlowPlanMarkdownHeader,
  type FlowPlanStatusTone,
} from '@/src/utils/flowJsonMarkdown';
import { prepareChatMarkdownForMd4c } from '@/src/utils/htmlParagraphsToMarkdown';
import { softWrapLongCodeFenceLines } from '@/src/utils/markdownSoftWrap';

import {
  COMPOSER_INLINE_EMOJI_RENDER_SIZE,
  COMPOSER_MD4C_FLAGS,
  PARAGRAPH_LINE_HEIGHT,
} from './utils/markdownStyle';
import {
  groupCustomEmojiMarkdownSegmentsByLine,
  hasCustomEmojiInMarkdown,
  parseCustomEmojiMarkdownSegments,
  type CustomEmojiMarkdownSegment,
} from './utils/parseCustomEmojiMarkdownSegments';
import { canRenderInlineRich } from './utils/parseInlineRich';
import { RichInlineText } from './rich-inline-text';
import { chatOpenProfiler } from '@/src/features/chat/chatOpenProfiler';

type ConversationComposerMarkdownBodyProps = {
  markdown: string;
  markdownStyle: MarkdownStyle;
  containerStyle?: ViewStyle;
  onLinkPress?: (event: LinkPressEvent) => void;
  selectable?: boolean;
  /** Current user id - lets the inline renderer highlight the user's own mentions. */
  currentUserId?: string;
  /** Whether this message was authored by the current user (own bubble). */
  isOwnMessage?: boolean;
  /** Deterministic release-safe clamp for long bodies. Expansion is handled by the caller. */
  collapsedNumberOfLines?: number;
};

const emojiBoxStyle = {
  width: COMPOSER_INLINE_EMOJI_RENDER_SIZE,
  height: COMPOSER_INLINE_EMOJI_RENDER_SIZE,
  marginHorizontal: 1,
} as const;
const emojiLineStyle = {
  width: '100%',
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'center',
} as const;

const getPlanStatusPillPalette = (
  tone: FlowPlanStatusTone,
): { backgroundColor: string; color: string } => {
  switch (tone) {
    case 'completed':
      return { backgroundColor: '#dcfce7', color: '#166534' };
    case 'pending':
      return { backgroundColor: '#fef3c7', color: '#a16207' };
    case 'in_progress':
      return { backgroundColor: '#e5f1fe', color: '#1264a3' };
    case 'failed':
      return { backgroundColor: '#fee2e2', color: '#b91c1c' };
  }
};

const getCollapsedMaxHeight = (
  markdownStyle: MarkdownStyle,
  collapsedNumberOfLines: number,
): number => {
  const paragraphLineHeight = markdownStyle.paragraph?.lineHeight;
  return (
    (typeof paragraphLineHeight === 'number' ? paragraphLineHeight : PARAGRAPH_LINE_HEIGHT) *
    collapsedNumberOfLines
  );
};

const ConversationComposerMarkdownBodyInner = ({
  markdown,
  markdownStyle,
  containerStyle,
  onLinkPress,
  selectable = false,
  currentUserId,
  isOwnMessage = false,
  collapsedNumberOfLines,
}: ConversationComposerMarkdownBodyProps): ReactElement => {
  chatOpenProfiler.count('markdown_body_render');
  const segments = useMemo(() => parseCustomEmojiMarkdownSegments(markdown), [markdown]);
  const emojiLines = useMemo(() => groupCustomEmojiMarkdownSegmentsByLine(segments), [segments]);
  const emojiIds = useMemo(
    () =>
      segments
        .filter(
          (segment): segment is Extract<typeof segment, { type: 'customEmoji' }> =>
            segment.type === 'customEmoji',
        )
        .map(segment => segment.emojiId),
    [segments],
  );
  const uriMap = useMtlsEmojiUris(emojiIds);
  const hasCustomEmojis = hasCustomEmojiInMarkdown(markdown);
  if (hasCustomEmojis) {
    chatOpenProfiler.count('markdown_body_custom_emoji');
  }

  const inlineMarkdownStyle = useMemo<MarkdownStyle>(
    () => ({
      ...markdownStyle,
      paragraph: {
        ...markdownStyle.paragraph,
        marginTop: 0,
        marginBottom: 0,
      },
    }),
    [markdownStyle],
  );

  const md4cMarkdown = useMemo(
    () => prepareChatMarkdownForMd4c(softWrapLongCodeFenceLines(markdown)),
    [markdown],
  );
  const collapsedContainerStyle = useMemo<ViewStyle | undefined>(
    () =>
      collapsedNumberOfLines
        ? {
            maxHeight: getCollapsedMaxHeight(markdownStyle, collapsedNumberOfLines),
            overflow: 'hidden',
          }
        : undefined,
    [collapsedNumberOfLines, markdownStyle],
  );

  // Inline-only messages render through our own native <Text> tree so mentions
  // get a distinct color + highlight (md4c shares one `link` style) and the
  // first paint is synchronous (no md4c settle/blink). Emoji and block content
  // (lists/code blocks/quotes/headings/LaTeX) fall back to md4c below.
  if (canRenderInlineRich(markdown)) {
    chatOpenProfiler.count('markdown_body_inline_rich');
    return (
      <RichInlineText
        markdown={markdown}
        markdownStyle={markdownStyle}
        {...(containerStyle ? { containerStyle } : {})}
        {...(onLinkPress ? { onLinkPress } : {})}
        {...(currentUserId ? { currentUserId } : {})}
        isOwnMessage={isOwnMessage}
        selectable={selectable}
        {...(collapsedNumberOfLines ? { numberOfLines: collapsedNumberOfLines } : {})}
      />
    );
  }

  if (!hasCustomEmojis) {
    return (
      <View style={collapsedContainerStyle}>
        <EnrichedMarkdownText
          key={md4cMarkdown}
          md4cFlags={COMPOSER_MD4C_FLAGS}
          markdown={md4cMarkdown}
          markdownStyle={markdownStyle}
          {...(containerStyle ? { containerStyle } : {})}
          {...(onLinkPress ? { onLinkPress } : {})}
          selectable={selectable}
        />
      </View>
    );
  }

  const emojiBlankLineStyle = {
    width: '100%' as const,
    height:
      typeof markdownStyle.paragraph?.lineHeight === 'number'
        ? markdownStyle.paragraph.lineHeight
        : PARAGRAPH_LINE_HEIGHT,
  };

  const renderEmojiLineSegment = (
    segment: CustomEmojiMarkdownSegment,
    key: string,
  ): ReactElement | null => {
    if (segment.type === 'customEmoji') {
      const label = segment.name ? `:${segment.name}:` : 'custom emoji';
      const resolvedUri = segment.uri ?? uriMap[segment.emojiId] ?? null;
      const fetchFailed = uriMap[segment.emojiId] === null && !segment.uri;

      if (resolvedUri) {
        return (
          <Image
            key={key}
            source={{ uri: resolvedUri }}
            style={emojiBoxStyle}
            contentFit='contain'
            cachePolicy='memory-disk'
            recyclingKey={`${segment.emojiId}:${resolvedUri}`}
            accessibilityLabel={label}
          />
        );
      }

      if (fetchFailed) {
        return (
          <Text key={key} className='text-xs text-muted' accessibilityLabel={label}>
            {label}
          </Text>
        );
      }

      // Loading - reserve space like the emoji picker; never flash `:name:` text.
      return <View key={key} style={emojiBoxStyle} />;
    }

    if (!segment.markdown.trim()) return null;

    if (canRenderInlineRich(segment.markdown)) {
      return (
        <RichInlineText
          key={key}
          markdown={segment.markdown}
          markdownStyle={inlineMarkdownStyle}
          containerStyle={{ flexShrink: 1 }}
          {...(onLinkPress ? { onLinkPress } : {})}
          {...(currentUserId ? { currentUserId } : {})}
          isOwnMessage={isOwnMessage}
          selectable={selectable}
        />
      );
    }

    return (
      <EnrichedMarkdownText
        key={key}
        md4cFlags={COMPOSER_MD4C_FLAGS}
        markdown={prepareChatMarkdownForMd4c(softWrapLongCodeFenceLines(segment.markdown))}
        markdownStyle={inlineMarkdownStyle}
        containerStyle={{ flexShrink: 1 }}
        {...(onLinkPress ? { onLinkPress } : {})}
        selectable={selectable}
      />
    );
  };

  return (
    <View style={[containerStyle, collapsedContainerStyle]}>
      {emojiLines.map((line, lineIndex) => (
        <View
          key={`emoji-line-${lineIndex}`}
          style={line.length === 0 ? emojiBlankLineStyle : emojiLineStyle}
        >
          {line.map((segment, index) =>
            renderEmojiLineSegment(segment, `${segment.type}-${lineIndex}-${index}`),
          )}
        </View>
      ))}
    </View>
  );
};

const ConversationComposerMarkdownBodyComponent = ({
  markdown,
  markdownStyle,
  containerStyle,
  onLinkPress,
  selectable = false,
  currentUserId,
  isOwnMessage = false,
  collapsedNumberOfLines,
}: ConversationComposerMarkdownBodyProps): ReactElement => {
  const planHeader = useMemo(() => extractFlowPlanMarkdownHeader(markdown), [markdown]);

  if (planHeader) {
    const palette = getPlanStatusPillPalette(planHeader.statusTone);
    return (
      <View style={containerStyle}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: planHeader.restMarkdown.trim() ? 6 : 0,
          }}
        >
          <Text
            style={{
              color: markdownStyle.paragraph?.color ?? '#1f2937',
              fontSize: markdownStyle.paragraph?.fontSize ?? 16,
              lineHeight: markdownStyle.paragraph?.lineHeight ?? 20,
              fontWeight: '700',
            }}
          >
            {planHeader.title}
          </Text>
          <View
            style={{
              marginLeft: 8,
              borderRadius: 6,
              backgroundColor: palette.backgroundColor,
              paddingHorizontal: 8,
              paddingVertical: 2,
            }}
          >
            <Text
              style={{
                color: palette.color,
                fontSize: 13,
                lineHeight: 17,
                fontWeight: '700',
              }}
            >
              {planHeader.statusLabel}
            </Text>
          </View>
        </View>
        {planHeader.restMarkdown.trim() ? (
          <ConversationComposerMarkdownBodyInner
            markdown={planHeader.restMarkdown}
            markdownStyle={markdownStyle}
            {...(onLinkPress ? { onLinkPress } : {})}
            selectable={selectable}
            {...(currentUserId ? { currentUserId } : {})}
            isOwnMessage={isOwnMessage}
            {...(collapsedNumberOfLines ? { collapsedNumberOfLines } : {})}
          />
        ) : null}
      </View>
    );
  }

  return (
    <ConversationComposerMarkdownBodyInner
      markdown={markdown}
      markdownStyle={markdownStyle}
      {...(containerStyle ? { containerStyle } : {})}
      {...(onLinkPress ? { onLinkPress } : {})}
      selectable={selectable}
      {...(currentUserId ? { currentUserId } : {})}
      isOwnMessage={isOwnMessage}
      {...(collapsedNumberOfLines ? { collapsedNumberOfLines } : {})}
    />
  );
};

const ConversationComposerMarkdownBody = memo(ConversationComposerMarkdownBodyComponent);
ConversationComposerMarkdownBody.displayName = 'ConversationComposerMarkdownBody';

export { ConversationComposerMarkdownBody };
