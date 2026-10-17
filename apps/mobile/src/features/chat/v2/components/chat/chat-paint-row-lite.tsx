import { Image } from 'expo-image';
import { memo, useCallback, useMemo, type ReactElement } from 'react';
import {
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { CircleDot } from 'lucide-react-native';
import { ChannelScopeType } from '@xyne/shared';
import { useCSSVariable } from 'uniwind';

import Avatar from '@/src/components/ui/avatar';
import { useChatUserProfileActionsSheet } from '@/src/features/chat/v2/components/chat/chat-user-profile-actions-sheet';
import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';
import { cn } from '@/src/utils/cn';
import { colorFromUsernamePalette } from '@/src/features/chat/v2/components/conversation-composer/utils/getUserColor';
import {
  useChatRenderTokens,
  type ChatRenderTokens,
} from '@/src/features/chat/v2/components/chat/message-row';
import {
  buildComposerMarkdownStyle,
  COMPACT_ACTIVITY_BODY_TEXT_STYLE,
  COMPOSER_INLINE_EMOJI_RENDER_SIZE,
  PARAGRAPH_LINE_HEIGHT,
  PRIMARY_BODY_TEXT_STYLE,
} from '@/src/features/chat/v2/components/conversation-composer/utils/markdownStyle';
import { invalidateResolvedEmojiUri, useMtlsEmojiUris } from '@/src/hooks/useMtlsEmoji';
import { getSenderAvatarFallbackUsers } from '@/src/features/chat/v2/paint/chatPaintAvatarFallback';
import { LinkPreviewCard } from '@/src/features/chat/v2/components/chat/link-preview-card';
import { PaintSenderNameLabel } from '@/src/features/chat/v2/components/chat/paint-sender-name-label';
import { PaintTimeLabel } from '@/src/features/chat/v2/components/chat/paint-time-label';
import { MessageBookmarkReminderIndicator } from '@/src/features/chat/v2/components/chat/message-bookmark-reminder-indicator';
import { RichInlineTextWithPalette } from '@/src/features/chat/v2/components/conversation-composer/rich-inline-text';
import { CHAT_PAINT_REACTION_SLOT_HEIGHT_PX } from '@/src/features/chat/v2/paint/chatPaintSizing';
import { ConversationComposerMarkdownBody } from '@/src/features/chat/v2/components/conversation-composer/conversation-composer-markdown-body';
import { DeletedMessagePlaceholderText } from '@/src/features/chat/v2/components/conversation-composer/conversation-composer-deleted';
import { hasBlockMarkdown } from '@/src/features/chat/v2/components/conversation-composer/utils/parseInlineRich';
import { hasMarkdownTable } from '@/src/utils/markdownTable';
import { DELETED_ATTACHMENT_PLACEHOLDER } from '@/src/utils/activeAttachments';
import { useMentionPress } from '@/src/features/chat/v2/components/conversation-composer/utils/useMentionPress';
import {
  PaintMediaPlaceholder,
  PaintParentPreview,
  PaintReactionSummary,
  PaintRecordingPreviewCard,
  PaintReplyTray,
  PaintTicketPreviewCard,
} from './chat-paint-render-pieces';
import {
  getChatPaintPreviewMode,
  groupPaintPreviewSegmentsByLine,
  type ChatPaintPreviewSegment,
} from './chat-paint-preview-policy';

type ChatPaintRowLiteProps = {
  row: ChatPaintRow;
  channelType?: ChannelScopeType;
  isPreviousTicketActivity?: boolean;
  isNextTicketActivity?: boolean;
  hydrateInlineEmoji?: boolean | undefined;
  isExpanded?: boolean;
  onExpand?: (conversationId: string) => void;
  /** Press handlers scoped to the embedded ticket card only, not the whole row. */
  onTicketPress?: (() => void) | undefined;
  onTicketLongPress?: (() => void) | undefined;
};

const READ_MORE_VERTICAL_GAP = 4;
const EMOJI_BOX_STYLE = {
  width: COMPOSER_INLINE_EMOJI_RENDER_SIZE,
  height: COMPOSER_INLINE_EMOJI_RENDER_SIZE,
  marginHorizontal: 1,
} as const;
const EMOJI_FILL_STYLE = { width: '100%' as const, height: '100%' as const };
const EMOJI_LINE_STYLE = {
  width: '100%' as const,
  flexDirection: 'row' as const,
  flexWrap: 'wrap' as const,
  alignItems: 'center' as const,
};

type TextPaintPreviewSegment = Extract<
  ChatPaintPreviewSegment,
  { kind: 'text' | 'link' | 'mention' }
>;

type PaintPreviewRendererProps = {
  segments: ChatPaintPreviewSegment[];
  bodyTextColor: string;
  bodyTextStyle: StyleProp<TextStyle>;
  className?: string | undefined;
  isCollapsed: boolean;
  collapsedLines: number;
  readMore: ReactElement | null;
};

type InteractivePaintPreviewRendererProps = PaintPreviewRendererProps & {
  isOwnMessage: boolean;
  messageLinkColor: string;
  mentionPalette: ChatRenderTokens['mentionPalette'];
};

const renderInteractiveTextSegment = (
  segment: TextPaintPreviewSegment,
  index: number,
  {
    isOwnMessage,
    messageLinkColor,
    mentionPalette,
    onLinkPress,
  }: {
    isOwnMessage: boolean;
    messageLinkColor: string;
    mentionPalette: ChatRenderTokens['mentionPalette'];
    onLinkPress: (url: string) => void;
  },
): ReactElement => {
  if (segment.kind === 'link') {
    return (
      <Text
        key={`${index}:${segment.text}`}
        style={{ color: messageLinkColor, textDecorationLine: 'underline' }}
        onPress={() => onLinkPress(segment.url ?? segment.text)}
      >
        {segment.text}
      </Text>
    );
  }
  if (segment.kind === 'mention') {
    const mentionBg = isOwnMessage
      ? segment.mentionsYou
        ? mentionPalette.currentSelfBg
        : mentionPalette.currentOtherBg
      : segment.mentionsYou
        ? mentionPalette.mentionedYouBg
        : mentionPalette.otherBg;
    const mentionText = isOwnMessage
      ? segment.mentionsYou
        ? mentionPalette.currentSelfText
        : mentionPalette.currentOtherText
      : segment.mentionsYou
        ? mentionPalette.mentionedYouText
        : mentionPalette.otherText;
    return (
      <Text
        key={`${index}:${segment.text}`}
        style={{ backgroundColor: mentionBg, textDecorationLine: 'none' }}
      >
        <Text style={{ color: mentionText, textDecorationLine: 'none' }}>{segment.text}</Text>
      </Text>
    );
  }
  return <Text key={`${index}:${segment.text}`}>{segment.text}</Text>;
};

const PlainPaintPreviewText = ({
  segments,
  bodyTextColor,
  bodyTextStyle,
  className,
  isCollapsed,
  collapsedLines,
  readMore,
}: PaintPreviewRendererProps): ReactElement => {
  const text = segments.map(segment => segment.text).join('') || 'Message';

  return (
    <View {...(className ? { className } : {})}>
      <Text
        style={[bodyTextStyle, { color: bodyTextColor }]}
        {...(isCollapsed ? { numberOfLines: collapsedLines } : {})}
      >
        {text}
      </Text>
      {readMore}
    </View>
  );
};

const InteractivePaintPreviewText = ({
  segments,
  bodyTextColor,
  bodyTextStyle,
  className,
  isCollapsed,
  collapsedLines,
  readMore,
  isOwnMessage,
  messageLinkColor,
  mentionPalette,
}: InteractivePaintPreviewRendererProps): ReactElement => {
  const handleLinkPress = useMentionPress();
  const children = segments.map((segment, index) =>
    segment.kind === 'emoji'
      ? null
      : renderInteractiveTextSegment(segment, index, {
          isOwnMessage,
          messageLinkColor,
          mentionPalette,
          onLinkPress: url => {
            void handleLinkPress(url);
          },
        }),
  );

  return (
    <View {...(className ? { className } : {})}>
      <Text
        style={[bodyTextStyle, { color: bodyTextColor }]}
        {...(isCollapsed ? { numberOfLines: collapsedLines } : {})}
      >
        {children}
      </Text>
      {readMore}
    </View>
  );
};

const EmojiPaintPreviewText = ({
  segments,
  bodyTextColor,
  bodyTextStyle,
  className,
  isCollapsed,
  collapsedLines,
  readMore,
  isOwnMessage,
  messageLinkColor,
  mentionPalette,
  hydrateInlineEmoji,
  markdownMaxWidth,
  mutedForeground,
  conversationId,
}: InteractivePaintPreviewRendererProps & {
  hydrateInlineEmoji: boolean;
  markdownMaxWidth: number;
  mutedForeground: string;
  conversationId: string;
}): ReactElement => {
  const emojiIds = useMemo(
    () =>
      Array.from(
        new Set(
          segments.flatMap(segment =>
            segment.kind === 'emoji' && segment.emojiId ? [segment.emojiId] : [],
          ),
        ),
      ),
    [segments],
  );
  const emojiUris = useMtlsEmojiUris(hydrateInlineEmoji ? emojiIds : []);
  const handleLinkPress = useMentionPress();
  const emojiLines = useMemo(() => groupPaintPreviewSegmentsByLine(segments), [segments]);
  const collapsedBodyStyle = isCollapsed
    ? {
        maxHeight: PARAGRAPH_LINE_HEIGHT * collapsedLines,
        overflow: 'hidden' as const,
      }
    : undefined;

  return (
    <View {...(className ? { className } : {})} style={{ maxWidth: markdownMaxWidth }}>
      <View style={collapsedBodyStyle}>
        {emojiLines.map((line, lineIndex) => (
          <View
            key={`emoji-line-${lineIndex}`}
            style={
              line.length === 0
                ? { width: '100%', height: PARAGRAPH_LINE_HEIGHT }
                : EMOJI_LINE_STYLE
            }
          >
            {line.map((segment, index) => {
              if (segment.kind !== 'emoji') {
                return (
                  <Text
                    key={`${lineIndex}:${index}:${segment.text}`}
                    style={[bodyTextStyle, { color: bodyTextColor, flexShrink: 1 }]}
                  >
                    {renderInteractiveTextSegment(segment, index, {
                      isOwnMessage,
                      messageLinkColor,
                      mentionPalette,
                      onLinkPress: url => {
                        void handleLinkPress(url);
                      },
                    })}
                  </Text>
                );
              }

              const uri = hydrateInlineEmoji
                ? (segment.uri ?? emojiUris[segment.emojiId] ?? null)
                : null;
              const label = segment.name ? `:${segment.name}:` : 'custom emoji';

              return (
                <View key={`${lineIndex}:${index}:${segment.emojiId}`} style={EMOJI_BOX_STYLE}>
                  {uri ? (
                    <Image
                      source={{ uri }}
                      style={EMOJI_FILL_STYLE}
                      contentFit='contain'
                      cachePolicy='memory-disk'
                      recyclingKey={`${conversationId}:${segment.emojiId}`}
                      accessibilityLabel={label}
                      onError={() => {
                        invalidateResolvedEmojiUri(segment.emojiId, uri);
                      }}
                    />
                  ) : (
                    <View
                      style={{
                        flex: 1,
                        borderRadius: 4,
                        backgroundColor: mutedForeground,
                        opacity: 0.18,
                      }}
                      accessibilityLabel={label}
                    />
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </View>
      {readMore}
    </View>
  );
};

const InlineRichPaintPreviewText = ({
  markdown,
  markdownMaxWidth,
  bodyTextColor,
  foregroundMuted,
  cardBg,
  brand,
  messageLinkColor,
  compact,
  mentionPalette,
  isOwnMessage,
  currentUserId,
  className,
  isCollapsed,
  collapsedLines,
  readMore,
}: {
  markdown: string;
  markdownMaxWidth: number;
  bodyTextColor: string;
  foregroundMuted: string;
  cardBg: string;
  brand: string;
  messageLinkColor: string;
  compact: boolean;
  mentionPalette: ChatRenderTokens['mentionPalette'];
  isOwnMessage: boolean;
  currentUserId?: string | undefined;
  className?: string | undefined;
  isCollapsed: boolean;
  collapsedLines: number;
  readMore: ReactElement | null;
}): ReactElement => {
  const handleLinkPress = useMentionPress();
  const inlineMarkdownStyle = useMemo(
    () =>
      buildComposerMarkdownStyle({
        foreground: bodyTextColor,
        foregroundMuted,
        cardBg,
        brand,
        linkColor: messageLinkColor,
        ...(compact ? { variant: 'compactActivity' as const } : {}),
      }),
    [bodyTextColor, foregroundMuted, cardBg, brand, compact, messageLinkColor],
  );

  return (
    <View {...(className ? { className } : {})}>
      <RichInlineTextWithPalette
        markdown={markdown}
        markdownStyle={inlineMarkdownStyle}
        mentionPalette={mentionPalette}
        containerStyle={{ maxWidth: markdownMaxWidth }}
        isOwnMessage={isOwnMessage}
        onLinkPress={({ url }) => {
          void handleLinkPress(url);
        }}
        selectable={false}
        {...(currentUserId ? { currentUserId } : {})}
        {...(isCollapsed ? { numberOfLines: collapsedLines } : {})}
      />
      {readMore}
    </View>
  );
};

const PaintPreviewText = ({
  row,
  className,
  compact = false,
  textColor,
  hydrateInlineEmoji = true,
  isExpanded = false,
  onExpand,
}: {
  row: ChatPaintRow;
  className?: string | undefined;
  compact?: boolean;
  textColor?: string | undefined;
  hydrateInlineEmoji?: boolean | undefined;
  isExpanded?: boolean;
  onExpand?: (conversationId: string) => void;
}): ReactElement => {
  // Mention chip tokens are kept in step with the rich `RichInlineText` renderer so
  // the lite-to-rich promotion shows no color/highlight pop. All colors come from
  // the shared chat render-token context (read once at the list) so each row pays
  // a single cheap useContext instead of several CSS-variable subscriptions on mount.
  const {
    foregroundMuted,
    cardBg,
    brand,
    linkColor,
    linkColorUser,
    mentionPalette,
    inlineContentMaxWidth,
    actionPrimaryColor,
    rootTextOther,
    rootTextUser,
    mutedForeground,
    tableHeaderBg,
    tableBorderColor,
  } = useChatRenderTokens();
  const isOwnMessage = row.rowKind === 'CURRENT_USER' || row.senderPaintModel.isCurrentUser;
  const bodyTextColor = textColor ?? (isOwnMessage ? rootTextUser : rootTextOther);
  const bodyTextStyle = compact ? COMPACT_ACTIVITY_BODY_TEXT_STYLE : PRIMARY_BODY_TEXT_STYLE;
  const messageLinkColor = isOwnMessage ? linkColorUser : linkColor;
  const readMoreColor = isOwnMessage ? actionPrimaryColor : linkColor;
  const handleLinkPress = useMentionPress();
  const segments = useMemo<ChatPaintPreviewSegment[]>(
    () =>
      row.body.segments.length
        ? row.body.segments
        : [
            {
              text: row.plainPreviewText || (row.allAttachmentsDeleted ? '' : 'Message'),
              kind: 'text' as const,
            },
          ],
    [row.allAttachmentsDeleted, row.body.segments, row.plainPreviewText],
  );
  const inlineMarkdown = row.body.inlineMarkdown ?? row.inlineMarkdown;
  const previewMode = getChatPaintPreviewMode({
    inlineMarkdown,
    plainText: row.body.plainText,
    segments,
  });
  const markdownMaxWidth = inlineContentMaxWidth;
  const isCollapsed = row.collapse.isCollapsible && !isExpanded;

  const handleReadMorePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onExpand?.(row.conversationId);
    },
    [onExpand, row.conversationId],
  );

  const readMore = isCollapsed ? (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel='Read more'
      hitSlop={8}
      onPress={handleReadMorePress}
      className='self-start'
      style={{ paddingTop: READ_MORE_VERTICAL_GAP, paddingBottom: READ_MORE_VERTICAL_GAP }}
    >
      <Text
        style={{
          color: readMoreColor,
          fontSize: 15,
          lineHeight: 20,
          fontWeight: '600',
        }}
      >
        Read more
      </Text>
    </Pressable>
  ) : null;

  if (row.isDeleted) {
    return (
      <View {...(className ? { className } : {})}>
        <DeletedMessagePlaceholderText />
      </View>
    );
  }

  if (previewMode === 'inline-rich' && inlineMarkdown) {
    return (
      <InlineRichPaintPreviewText
        markdown={inlineMarkdown}
        markdownMaxWidth={markdownMaxWidth}
        bodyTextColor={bodyTextColor}
        foregroundMuted={foregroundMuted}
        cardBg={cardBg}
        brand={brand}
        messageLinkColor={messageLinkColor}
        compact={compact}
        mentionPalette={mentionPalette}
        isOwnMessage={isOwnMessage}
        currentUserId={row.currentUserId}
        className={className}
        isCollapsed={isCollapsed}
        collapsedLines={row.collapse.collapsedLines}
        readMore={readMore}
      />
    );
  }

  if (hasBlockMarkdown(row.body.markdown)) {
    const markdownStyle = buildComposerMarkdownStyle({
      foreground: bodyTextColor,
      foregroundMuted,
      cardBg,
      brand,
      linkColor: messageLinkColor,
      tableHeaderBackground: tableHeaderBg,
      tableBorderColor,
      ...(compact ? { variant: 'compactActivity' as const } : {}),
    });

    return (
      <View {...(className ? { className } : {})}>
        <ConversationComposerMarkdownBody
          markdown={row.body.markdown}
          markdownStyle={markdownStyle}
          containerStyle={{ maxWidth: markdownMaxWidth }}
          onLinkPress={({ url }) => {
            void handleLinkPress(url);
          }}
          selectable={false}
          {...(row.currentUserId ? { currentUserId: row.currentUserId } : {})}
          isOwnMessage={isOwnMessage}
          hydrateInlineEmoji={hydrateInlineEmoji}
          {...(hasMarkdownTable(row.body.markdown) ? { flavor: 'github' as const } : {})}
          {...(isCollapsed ? { collapsedNumberOfLines: row.collapse.collapsedLines } : {})}
        />
        {readMore}
      </View>
    );
  }

  if (previewMode === 'emoji') {
    return (
      <EmojiPaintPreviewText
        segments={segments}
        bodyTextColor={bodyTextColor}
        bodyTextStyle={bodyTextStyle}
        className={className}
        isCollapsed={isCollapsed}
        collapsedLines={row.collapse.collapsedLines}
        readMore={readMore}
        isOwnMessage={isOwnMessage}
        messageLinkColor={messageLinkColor}
        mentionPalette={mentionPalette}
        hydrateInlineEmoji={hydrateInlineEmoji}
        markdownMaxWidth={markdownMaxWidth}
        mutedForeground={mutedForeground}
        conversationId={row.conversationId}
      />
    );
  }

  if (previewMode === 'interactive-segments') {
    return (
      <InteractivePaintPreviewText
        segments={segments}
        bodyTextColor={bodyTextColor}
        bodyTextStyle={bodyTextStyle}
        className={className}
        isCollapsed={isCollapsed}
        collapsedLines={row.collapse.collapsedLines}
        readMore={readMore}
        isOwnMessage={isOwnMessage}
        messageLinkColor={messageLinkColor}
        mentionPalette={mentionPalette}
      />
    );
  }

  return (
    <PlainPaintPreviewText
      segments={segments}
      bodyTextColor={bodyTextColor}
      bodyTextStyle={bodyTextStyle}
      className={className}
      isCollapsed={isCollapsed}
      collapsedLines={row.collapse.collapsedLines}
      readMore={readMore}
    />
  );
};

const PaintAvatar = ({ row }: { row: ChatPaintRow }): ReactElement | null => {
  const profileActions = useChatUserProfileActionsSheet();
  const handlePress = useCallback(
    (event: GestureResponderEvent): void => {
      event.stopPropagation();
      profileActions?.openUserProfileActions({
        userId: row.senderPaintModel.senderId,
        displayName: row.senderPaintModel.displayName,
      });
    },
    [profileActions, row.senderPaintModel.displayName, row.senderPaintModel.senderId],
  );

  if (!row.showAvatar) {
    return <View className='h-6 w-6' />;
  }

  const avatar = (
    <Avatar
      userIds={row.senderPaintModel.senderId ? [row.senderPaintModel.senderId] : []}
      fallbackUsers={getSenderAvatarFallbackUsers(row.senderPaintModel)}
      size={24}
    />
  );

  if (!profileActions || !row.senderPaintModel.senderId) {
    return avatar;
  }

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={`Open ${row.senderPaintModel.displayName} profile actions`}
      hitSlop={6}
      onPress={handlePress}
      style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
    >
      {avatar}
    </Pressable>
  );
};

const TicketActivityTimelineRow = ({
  row,
  isPreviousTicketActivity = false,
  isNextTicketActivity = false,
  hydrateInlineEmoji,
}: {
  row: ChatPaintRow;
  isPreviousTicketActivity?: boolean;
  isNextTicketActivity?: boolean;
  hydrateInlineEmoji: boolean;
}): ReactElement => {
  const { actionPrimaryColor } = useChatRenderTokens();
  const activityTextColor = useCSSVariable('--color-secondary-foreground') as string;

  return (
    <View
      className={cn(
        'flex-row gap-2.5',
        isPreviousTicketActivity ? '' : 'mt-2',
        isNextTicketActivity ? '' : 'mb-4',
      )}
    >
      <View className='w-5 items-center self-stretch'>
        <CircleDot size={16} color={actionPrimaryColor} strokeWidth={2.25} />
        {isNextTicketActivity ? <View className='my-1 w-px flex-1 bg-border' /> : null}
      </View>
      <View className='min-w-0 flex-1 flex-row items-start gap-2 pb-4'>
        <View className='min-w-0 flex-1'>
          <PaintPreviewText
            key={row.conversationId}
            row={row}
            compact
            textColor={activityTextColor}
            hydrateInlineEmoji={hydrateInlineEmoji}
          />
        </View>
        <View className='shrink-0'>
          <PaintTimeLabel
            messageId={row.messageId}
            timeLabel={row.timeLabel}
            textClass='text-xs text-secondary-foreground'
          />
        </View>
      </View>
    </View>
  );
};

const ChatPaintRowLiteComponent = ({
  row,
  channelType,
  isPreviousTicketActivity = false,
  isNextTicketActivity = false,
  hydrateInlineEmoji = true,
  isExpanded = false,
  onExpand,
  onTicketPress,
  onTicketLongPress,
}: ChatPaintRowLiteProps): ReactElement | null => {
  const renderTokens = useChatRenderTokens();
  const {
    ambientAccentColor,
    currentUserBubbleBg,
    embeddedBgUser,
    embeddedMutedUser,
    embeddedTitleUser,
    inlineContentMaxWidth,
    mutedForeground,
    rootAccentUser,
    rootMetaUser,
    rootTextOther,
    rootTextUser,
    usernamePalette,
  } = renderTokens;
  const profileActions = useChatUserProfileActionsSheet();
  const isCurrentUser = row.rowKind === 'CURRENT_USER' || row.senderPaintModel.isCurrentUser;
  const deletedAttachmentLabelColor = isCurrentUser ? rootTextUser : rootTextOther;
  const senderColor = colorFromUsernamePalette(usernamePalette, row.senderPaintModel.senderId);
  const bubbleBg = isCurrentUser
    ? 'bg-conversation-composer-root-bg-user'
    : 'bg-conversation-composer-root-bg-other';
  const bubbleShadow = isCurrentUser
    ? 'light:shadow-[0px_1px_0.25px_0px_rgba(11,20,26,0.06)] dark:shadow-none'
    : 'light:shadow-[0px_1px_0.5px_0px_rgba(11,20,26,0.06)] dark:shadow-[0px_1px_0.5px_0px_rgba(11,20,26,0.13)]';
  const justify = isCurrentUser ? 'justify-end' : 'justify-start';
  const isTicketRow = row.rowKind === 'TICKET' || !!row.ticketPreview;
  const isRecordingRow = !!row.recordingPreview;
  const hasExpandedBlockBody =
    isExpanded && !!row.body?.markdown && hasBlockMarkdown(row.body.markdown);
  const hasTableBody = !!row.body?.markdown && hasMarkdownTable(row.body.markdown);
  const fixedBubbleStyle =
    isTicketRow || isRecordingRow || row.mediaPlaceholder || hasExpandedBlockBody || hasTableBody
      ? { width: inlineContentMaxWidth }
      : undefined;
  const currentUserBubbleStyle = isCurrentUser ? { backgroundColor: currentUserBubbleBg } : null;
  const showContent =
    !isTicketRow &&
    !isRecordingRow &&
    (row.plainPreviewText.trim().length > 0 ||
      (!row.mediaPlaceholder && !row.allAttachmentsDeleted));
  const showReplyBorder =
    row.replyCount > 0 &&
    !isTicketRow &&
    !isRecordingRow &&
    !row.mediaPlaceholder &&
    !row.allAttachmentsDeleted;
  const reactionSummaryCount = row.reactionSummaryCount;
  const hasParentPreview = !!(row.parentPreview?.text ?? row.parentPreviewText);
  const replyCount = row.replyPreview?.count ?? row.replyCount;
  const handleSenderNamePress = useCallback(
    (event: GestureResponderEvent): void => {
      event.stopPropagation();
      profileActions?.openUserProfileActions({
        userId: row.senderPaintModel.senderId,
        displayName: row.senderPaintModel.displayName,
      });
    },
    [profileActions, row.senderPaintModel.displayName, row.senderPaintModel.senderId],
  );

  if (row.isTicketActivity) {
    return (
      <TicketActivityTimelineRow
        row={row}
        isPreviousTicketActivity={isPreviousTicketActivity}
        isNextTicketActivity={isNextTicketActivity}
        hydrateInlineEmoji={hydrateInlineEmoji}
      />
    );
  }

  if (row.rowKind === 'SYSTEM') {
    if (!row.plainPreviewText.trim()) return null;
    return (
      <View className='py-1 flex-row justify-center'>
        <View className='my-4 max-w-[95%] self-center rounded-lg bg-conversation-composer-system-bg p-1.5 light:shadow-[0px_1px_0.5px_0px_rgba(0,0,0,0.06)]'>
          <Text className='text-center text-[12.5px] font-medium leading-5 tracking-[-0.16px] text-conversation-composer-system-text'>
            {row.plainPreviewText}
          </Text>
        </View>
      </View>
    );
  }

  const showIdentity = channelType !== ChannelScopeType.DM;
  const showAvatarSlot = !isCurrentUser && channelType !== ChannelScopeType.DM;

  return (
    <View className={cn('py-1 flex-row items-end gap-2', justify)}>
      {showAvatarSlot ? (
        <View
          style={
            reactionSummaryCount > 0
              ? { marginBottom: CHAT_PAINT_REACTION_SLOT_HEIGHT_PX }
              : undefined
          }
        >
          <PaintAvatar row={row} />
        </View>
      ) : null}
      <View className='max-w-[78%]' style={fixedBubbleStyle}>
        <View
          className={cn('rounded-xl px-2 py-1.5', bubbleBg, bubbleShadow)}
          style={currentUserBubbleStyle}
        >
          {row.showSenderName && showIdentity ? (
            <PaintSenderNameLabel
              senderId={row.senderPaintModel.senderId}
              displayName={row.senderPaintModel.displayName}
              color={senderColor}
              {...(profileActions && row.senderPaintModel.senderId
                ? { onPress: handleSenderNamePress }
                : {})}
            />
          ) : null}

          {hasParentPreview ? <PaintParentPreview row={row} isCurrentUser={isCurrentUser} /> : null}

          {showContent ? (
            <PaintPreviewText
              key={row.conversationId}
              row={row}
              className='mb-2.5'
              hydrateInlineEmoji={hydrateInlineEmoji}
              isExpanded={isExpanded}
              {...(onExpand ? { onExpand } : {})}
            />
          ) : null}

          {row.ticketPreview ? (
            <PaintTicketPreviewCard
              row={row}
              isCurrentUser={isCurrentUser}
              {...(onTicketPress ? { onPress: onTicketPress } : {})}
              {...(onTicketPress && onTicketLongPress ? { onLongPress: onTicketLongPress } : {})}
            />
          ) : null}

          {row.recordingPreview ? (
            <PaintRecordingPreviewCard row={row} isCurrentUser={isCurrentUser} />
          ) : null}

          {row.linkPreview ? (
            <LinkPreviewCard
              preview={row.linkPreview}
              isCurrentUser={isCurrentUser}
              mutedForeground={mutedForeground}
              accentColor={ambientAccentColor}
              currentUserColors={{
                backgroundColor: embeddedBgUser,
                titleColor: embeddedTitleUser,
                mutedColor: embeddedMutedUser,
                accentColor: rootAccentUser,
              }}
            />
          ) : null}

          {row.mediaPlaceholder ? <PaintMediaPlaceholder media={row.mediaPlaceholder} /> : null}

          {row.allAttachmentsDeleted ? (
            <Text
              className='mb-2.5 text-[16px] italic leading-5'
              style={{ color: deletedAttachmentLabelColor }}
            >
              {DELETED_ATTACHMENT_PLACEHOLDER}
            </Text>
          ) : null}

          <View
            className={cn(
              'flex-row items-end gap-1',
              showReplyBorder ? 'border-t border-border pt-2' : '',
            )}
          >
            {replyCount > 0 ? <PaintReplyTray row={row} /> : null}
            <View className='flex-1' />
            <MessageBookmarkReminderIndicator
              messageId={row.messageId}
              iconColor={isCurrentUser ? rootMetaUser : '#999'}
              {...(isCurrentUser ? { textStyle: { color: rootMetaUser } } : {})}
            />
            <View className='self-end'>
              <PaintTimeLabel
                messageId={row.messageId}
                timeLabel={row.timeLabel}
                textClass={cn(
                  'text-[10px]',
                  isCurrentUser ? '' : 'text-conversation-composer-timestamp-other',
                )}
                {...(isCurrentUser ? { color: rootMetaUser } : {})}
              />
            </View>
          </View>
        </View>
        {reactionSummaryCount > 0 ? (
          <PaintReactionSummary
            conversationId={row.conversationId}
            messageId={row.reactionPreview?.messageId}
            groups={row.reactionPreview?.groups}
            reactions={row.reactionPreview?.reactions}
            fallbackCount={reactionSummaryCount}
          />
        ) : null}
      </View>
    </View>
  );
};

export const ChatPaintRowLite = memo(ChatPaintRowLiteComponent);
ChatPaintRowLite.displayName = 'ChatPaintRowLite';
