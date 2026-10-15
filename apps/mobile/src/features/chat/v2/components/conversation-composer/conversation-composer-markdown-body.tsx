import { Image } from 'expo-image';
import { memo, useMemo, type ReactElement } from 'react';
import { Text, View, type TextStyle, type ViewStyle } from 'react-native';
import {
  EnrichedMarkdownText,
  type LinkPressEvent,
  type MarkdownStyle,
} from 'react-native-enriched-markdown';

import { invalidateResolvedEmojiUri, useMtlsEmojiUris } from '@/src/hooks/useMtlsEmoji';
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
import { stripMarkdownForPreview } from './utils/markdownPreview';
import { canRenderInlineRich } from './utils/parseInlineRich';
import { RichInlineTextWithPalette } from './rich-inline-text';
import { useChatRenderTokens } from '@/src/features/chat/v2/components/chat/message-row';
import {
  MENTION_BROADCAST_SCHEME,
  MENTION_CHANNEL_SCHEME,
  MENTION_GROUP_SCHEME,
  MENTION_USER_SCHEME,
} from './utils/mentionSchemes';

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
  hydrateInlineEmoji?: boolean;
  /**
   * Markdown flavor for the native renderer. `'github'` is what turns GFM pipe
   * rows into a real scrollable table; leave it unset for chat, which has no
   * table syntax and renders through the plain commonmark path.
   */
  flavor?: 'commonmark' | 'github';
};

const emojiBoxStyle = {
  width: COMPOSER_INLINE_EMOJI_RENDER_SIZE,
  height: COMPOSER_INLINE_EMOJI_RENDER_SIZE,
  marginHorizontal: 1,
} as const;
const emojiFillStyle = {
  width: '100%',
  height: '100%',
} as const;
const emojiLineStyle = {
  width: '100%',
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'center',
} as const;
const EMPTY_EMOJI_IDS: string[] = [];
const LIST_MARKDOWN_PATTERN = /(?:^|\n)[ \t]{0,3}(?:\d+[.)]|[-+*])[ \t]+/;
const TRAILING_LIST_ITEM_MARKDOWN_PATTERN = /(?:^|\n)[ \t]{0,8}(?:\d+[.)]|[-+*])[ \t]+[^\n]*$/;
// md4c/TextKit can under-measure the final list item when the list is the last
// block. Keep the guard on its own zero-width line so the final item gets a
// complete line fragment without adding visible message text.
const NATIVE_LIST_END_GUARD = '\n\u200B';

const getCollapsedPreviewText = (markdown: string): string =>
  stripMarkdownForPreview(markdown).replace(/xemoji:[^:]+:([^:]*):emojix/g, (_, name: string) =>
    name ? `:${name}:` : '',
  );

const getCollapsedTextStyle = (markdownStyle: MarkdownStyle): TextStyle => {
  const paragraph = markdownStyle.paragraph;
  return {
    color: paragraph?.color,
    fontFamily: paragraph?.fontFamily,
    fontSize: paragraph?.fontSize,
    fontWeight: paragraph?.fontWeight as TextStyle['fontWeight'],
    lineHeight: paragraph?.lineHeight,
    textAlign: paragraph?.textAlign as TextStyle['textAlign'],
    marginTop: 0,
    marginBottom: 0,
  };
};

type MentionPalette = ReturnType<typeof useChatRenderTokens>['mentionPalette'];

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const mentionVariant = (backgroundColor: string, color: string) => ({
  backgroundColor,
  color,
  underline: false,
});

const buildMentionLinkVariants = ({
  mentionPalette,
  currentUserId,
  isOwnMessage,
}: {
  mentionPalette: MentionPalette;
  currentUserId?: string;
  isOwnMessage: boolean;
}): NonNullable<MarkdownStyle['linkVariants']> => {
  const currentMention = isOwnMessage
    ? mentionVariant(mentionPalette.currentSelfBg, mentionPalette.currentSelfText)
    : mentionVariant(mentionPalette.mentionedYouBg, mentionPalette.mentionedYouText);
  const otherMention = isOwnMessage
    ? mentionVariant(mentionPalette.currentOtherBg, mentionPalette.currentOtherText)
    : mentionVariant(mentionPalette.otherBg, mentionPalette.otherText);
  const broadcastMention = isOwnMessage
    ? mentionVariant(mentionPalette.currentSelfBg, mentionPalette.currentSelfText)
    : mentionVariant(mentionPalette.mentionedYouBg, mentionPalette.mentionedYouText);

  return {
    ...(currentUserId
      ? {
          [`^${escapeRegex(MENTION_USER_SCHEME)}${escapeRegex(currentUserId)}$`]: currentMention,
          [`^${escapeRegex(MENTION_USER_SCHEME)}${escapeRegex(encodeURIComponent(currentUserId))}$`]:
            currentMention,
        }
      : {}),
    [`^${escapeRegex(MENTION_BROADCAST_SCHEME)}`]: broadcastMention,
    [`^${escapeRegex(MENTION_USER_SCHEME)}`]: otherMention,
    [`^${escapeRegex(MENTION_CHANNEL_SCHEME)}`]: otherMention,
    [`^${escapeRegex(MENTION_GROUP_SCHEME)}`]: otherMention,
  };
};

const prepareMarkdownForNativeRender = (markdown: string): string => {
  const sourceMarkdown = softWrapLongCodeFenceLines(markdown);
  const needsListEndGuard =
    LIST_MARKDOWN_PATTERN.test(sourceMarkdown) &&
    TRAILING_LIST_ITEM_MARKDOWN_PATTERN.test(sourceMarkdown.trimEnd());
  const markdownForMeasurement = needsListEndGuard
    ? `${sourceMarkdown}${NATIVE_LIST_END_GUARD}`
    : sourceMarkdown;

  return prepareChatMarkdownForMd4c(markdownForMeasurement);
};

const getPlanStatusPillPalette = (
  tone: FlowPlanStatusTone,
): { backgroundColor: string; color: string } => {
  switch (tone) {
    case 'completed':
      return { backgroundColor: '#00A63E', color: '#ffffff' };
    case 'pending':
      return { backgroundColor: '#FF6900', color: '#ffffff' };
    case 'in_progress':
      return { backgroundColor: '#0561E2', color: '#ffffff' };
    case 'failed':
      return { backgroundColor: '#E7000B', color: '#ffffff' };
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
  hydrateInlineEmoji = true,
  flavor,
}: ConversationComposerMarkdownBodyProps): ReactElement => {
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
  const uriMap = useMtlsEmojiUris(hydrateInlineEmoji ? emojiIds : EMPTY_EMOJI_IDS);
  const hasCustomEmojis = hasCustomEmojiInMarkdown(markdown);
  const { mentionPalette } = useChatRenderTokens();
  const blockMarkdownStyle = useMemo<MarkdownStyle>(
    () => ({
      ...markdownStyle,
      linkVariants: {
        ...markdownStyle.linkVariants,
        ...buildMentionLinkVariants({
          mentionPalette,
          ...(currentUserId ? { currentUserId } : {}),
          isOwnMessage,
        }),
      },
    }),
    [currentUserId, isOwnMessage, markdownStyle, mentionPalette],
  );

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

  const md4cMarkdown = useMemo(() => prepareMarkdownForNativeRender(markdown), [markdown]);
  const collapsedContainerStyle = useMemo<ViewStyle | undefined>(
    () =>
      collapsedNumberOfLines
        ? {
            maxHeight: getCollapsedMaxHeight(blockMarkdownStyle, collapsedNumberOfLines),
            overflow: 'hidden',
          }
        : undefined,
    [blockMarkdownStyle, collapsedNumberOfLines],
  );

  // Inline-only messages render through our own native <Text> tree so mentions
  // get a distinct color + highlight (md4c shares one `link` style) and the
  // first paint is synchronous (no md4c settle/blink). Emoji and block content
  // (lists/code blocks/quotes/headings/LaTeX) fall back to md4c below.
  if (canRenderInlineRich(markdown)) {
    return (
      <RichInlineTextWithPalette
        markdown={markdown}
        markdownStyle={markdownStyle}
        mentionPalette={mentionPalette}
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
    // Always keep the same View → native host tree. Toggling Read more must
    // only change `maxHeight`, not remount `EnrichedMarkdownText` (that blinks).
    // `key={md4cMarkdown}` remounts only when a recycled list cell shows a
    // different message — in-place md4c updates are what glitch on scroll.
    return (
      <View style={collapsedContainerStyle}>
        <EnrichedMarkdownText
          key={md4cMarkdown}
          md4cFlags={COMPOSER_MD4C_FLAGS}
          {...(flavor ? { flavor } : {})}
          markdown={md4cMarkdown}
          markdownStyle={blockMarkdownStyle}
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
      const resolvedUri = hydrateInlineEmoji
        ? (segment.uri ?? uriMap[segment.emojiId] ?? null)
        : null;
      const fetchFailed = hydrateInlineEmoji && uriMap[segment.emojiId] === null && !segment.uri;

      if (resolvedUri) {
        return (
          <View key={key} style={emojiBoxStyle}>
            <Image
              source={{ uri: resolvedUri }}
              style={emojiFillStyle}
              contentFit='contain'
              cachePolicy='memory-disk'
              recyclingKey={`${segment.emojiId}:${resolvedUri}`}
              accessibilityLabel={label}
              onError={() => {
                invalidateResolvedEmojiUri(segment.emojiId, resolvedUri);
              }}
            />
          </View>
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
        <RichInlineTextWithPalette
          key={key}
          markdown={segment.markdown}
          markdownStyle={inlineMarkdownStyle}
          mentionPalette={mentionPalette}
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
        {...(flavor ? { flavor } : {})}
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
  hydrateInlineEmoji = true,
  flavor,
}: ConversationComposerMarkdownBodyProps): ReactElement => {
  const planHeader = useMemo(() => extractFlowPlanMarkdownHeader(markdown), [markdown]);

  if (planHeader) {
    if (collapsedNumberOfLines) {
      return (
        <View style={containerStyle}>
          <Text
            style={getCollapsedTextStyle(markdownStyle)}
            numberOfLines={collapsedNumberOfLines}
            selectable={selectable}
          >
            {getCollapsedPreviewText(markdown)}
          </Text>
        </View>
      );
    }

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
              lineHeight: markdownStyle.paragraph?.lineHeight ?? PARAGRAPH_LINE_HEIGHT,
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
            hydrateInlineEmoji={hydrateInlineEmoji}
            {...(flavor ? { flavor } : {})}
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
      hydrateInlineEmoji={hydrateInlineEmoji}
      {...(flavor ? { flavor } : {})}
    />
  );
};

const ConversationComposerMarkdownBody = memo(ConversationComposerMarkdownBodyComponent);
ConversationComposerMarkdownBody.displayName = 'ConversationComposerMarkdownBody';

export { ConversationComposerMarkdownBody };
