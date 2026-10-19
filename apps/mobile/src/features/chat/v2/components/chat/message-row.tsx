import { Image } from 'expo-image';
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useMemo,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Pressable, Text, type GestureResponderEvent, type TextStyle, View } from 'react-native';
import { ChannelScopeType, type User } from '@xyne/shared';

import Avatar from '@/src/components/ui/avatar';
import { useChatUserProfileActionsSheet } from '@/src/features/chat/v2/components/chat/chat-user-profile-actions-sheet';
import type {
  ChatPaintRow,
  PaintPreviewSegment,
} from '@/src/features/chat/v2/paint/chatPaint.types';
import { invalidateResolvedEmojiUri, useMtlsEmojiUris } from '@/src/hooks/useMtlsEmoji';
import { cn } from '@/src/utils/cn';
import { colorFromUsernamePalette } from '@/src/features/chat/v2/components/conversation-composer/utils/getUserColor';
import {
  buildComposerMarkdownStyle,
  COMPOSER_INLINE_EMOJI_RENDER_SIZE,
  PARAGRAPH_LINE_HEIGHT,
  PRIMARY_BODY_TEXT_STYLE,
} from '@/src/features/chat/v2/components/conversation-composer/utils/markdownStyle';
import type { ConversationItem } from '@/src/features/chat/v2/components/conversation-composer';
import { CHAT_PAINT_REACTION_SLOT_HEIGHT_PX } from '@/src/features/chat/v2/paint/chatPaintSizing';
import { getSenderAvatarFallbackUsers } from '@/src/features/chat/v2/paint/chatPaintAvatarFallback';
import { LinkPreviewCard } from '@/src/features/chat/v2/components/chat/link-preview-card';
import { PaintSenderNameLabel } from '@/src/features/chat/v2/components/chat/paint-sender-name-label';
import { PaintTimeLabel } from '@/src/features/chat/v2/components/chat/paint-time-label';
import { useMentionPress } from '@/src/features/chat/v2/components/conversation-composer/utils/useMentionPress';
import { ConversationComposerMarkdownBody } from '@/src/features/chat/v2/components/conversation-composer/conversation-composer-markdown-body';
import { DeletedMessagePlaceholderText } from '@/src/features/chat/v2/components/conversation-composer/conversation-composer-deleted';
import { hasBlockMarkdown } from '@/src/features/chat/v2/components/conversation-composer/utils/parseInlineRich';
import { MessageBookmarkReminderIndicator } from '@/src/features/chat/v2/components/chat/message-bookmark-reminder-indicator';
import {
  PaintMediaPlaceholder,
  PaintParentPreview,
  PaintReactionSummary,
  PaintRecordingPreviewCard,
  PaintReplyTray,
  PaintTicketPreviewCard,
} from './chat-paint-render-pieces';
import { RichInlineTextWithPalette } from '@/src/features/chat/v2/components/conversation-composer/rich-inline-text';
import { groupPaintPreviewSegmentsByLine } from '@/src/features/chat/v2/components/chat/chat-paint-preview-policy';

import { DEFAULT_CHAT_RENDER_TOKENS, type ChatRenderTokens } from '@/src/theme/chatRenderTokens';

export type { ChatRenderTokens };

/*
 * P5 contract: fidelity changes content, never geometry.
 * Row paint carries every geometry-affecting box. Hydration can sharpen content,
 * but it must never add/remove vertical space.
 */

export type MessageRowFidelity = 'reserved' | 'full';

type MessageRowProps = {
  row: ChatPaintRow;
  conversation: ConversationItem | undefined;
  fidelity: MessageRowFidelity;
  currentUser: User | undefined;
  channelType?: ChannelScopeType | undefined;
  isExpanded?: boolean;
  onExpand?: (conversationId: string) => void;
  onPress: () => void;
  onLongPress: () => void;
};

const ChatRenderContext = createContext<ChatRenderTokens>(DEFAULT_CHAT_RENDER_TOKENS);

export const ChatRenderProvider = ({
  value,
  children,
}: {
  value: ChatRenderTokens;
  children: ReactNode;
}): ReactElement => (
  <ChatRenderContext.Provider value={value}>{children}</ChatRenderContext.Provider>
);

export const useChatRenderTokens = (): ChatRenderTokens => useContext(ChatRenderContext);

const TEXT_STYLE: TextStyle = {
  ...PRIMARY_BODY_TEXT_STYLE,
};

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
const EMPTY_EMOJI_IDS: string[] = [];

const READ_MORE_VERTICAL_GAP = 4;
const OUTER_ROW_VERTICAL_PADDING = 8;

const getTextSegments = (row: ChatPaintRow): PaintPreviewSegment[] =>
  row.previewSegments?.length
    ? row.previewSegments
    : [{ text: row.plainPreviewText || 'Message', kind: 'text' }];

const MessageText = ({
  row,
  fidelity,
  isExpanded = false,
  onExpand,
}: {
  row: ChatPaintRow;
  fidelity: MessageRowFidelity;
  isExpanded?: boolean;
  onExpand?: (conversationId: string) => void;
}): ReactElement | null => {
  const {
    brand,
    cardBg,
    foregroundMuted,
    inlineContentMaxWidth,
    actionPrimaryColor,
    linkColor,
    linkColorUser,
    mentionPalette,
    mutedForeground,
    rootTextOther,
    rootTextUser,
  } = useChatRenderTokens();
  const segments = useMemo(() => getTextSegments(row), [row]);
  const emojiLines = useMemo(() => groupPaintPreviewSegmentsByLine(segments), [segments]);
  const hasEmojiSegments = segments.some(segment => segment.kind === 'emoji');
  const emojiIds = useMemo(
    () =>
      Array.from(
        new Set(
          segments
            .filter((segment): segment is Extract<PaintPreviewSegment, { kind: 'emoji' }> => {
              return segment.kind === 'emoji' && !!segment.emojiId;
            })
            .map(segment => segment.emojiId),
        ),
      ),
    [segments],
  );
  const emojiUris = useMtlsEmojiUris(fidelity === 'full' ? emojiIds : EMPTY_EMOJI_IDS);
  const handleLinkPress = useMentionPress();
  const isOwnMessage = row.rowKind === 'CURRENT_USER' || row.senderPaintModel.isCurrentUser;
  const bodyTextColor = isOwnMessage ? rootTextUser : rootTextOther;
  const messageLinkColor = isOwnMessage ? linkColorUser : linkColor;
  const readMoreColor = isOwnMessage ? actionPrimaryColor : linkColor;
  const isCollapsed = row.collapse.isCollapsible && !isExpanded;
  const inlineMarkdownStyle = useMemo(
    () =>
      buildComposerMarkdownStyle({
        foreground: bodyTextColor,
        foregroundMuted,
        cardBg,
        brand,
        linkColor: messageLinkColor,
      }),
    [bodyTextColor, brand, cardBg, foregroundMuted, messageLinkColor],
  );
  const handleReadMorePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onExpand?.(row.conversationId);
    },
    [onExpand, row.conversationId],
  );

  if (row.isDeleted) {
    return (
      <View className='mb-2.5'>
        <DeletedMessagePlaceholderText />
      </View>
    );
  }

  if (!row.plainPreviewText.trim() && segments.every(segment => segment.kind !== 'emoji')) {
    return null;
  }

  const renderTextSegment = (
    segment: Extract<PaintPreviewSegment, { kind: 'text' | 'link' | 'mention' }>,
    index: number,
  ): ReactElement => {
    if (segment.kind === 'link') {
      return (
        <Text
          key={`${index}:${segment.text}`}
          style={{ color: messageLinkColor, textDecorationLine: 'underline' }}
          onPress={() => {
            void handleLinkPress(segment.url ?? segment.text);
          }}
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

  const inlineMarkdown = row.body.inlineMarkdown ?? row.inlineMarkdown;
  if (inlineMarkdown && !hasEmojiSegments) {
    return (
      <View className='mb-2.5'>
        <RichInlineTextWithPalette
          markdown={inlineMarkdown}
          markdownStyle={inlineMarkdownStyle}
          mentionPalette={mentionPalette}
          containerStyle={{ maxWidth: inlineContentMaxWidth }}
          isOwnMessage={isOwnMessage}
          onLinkPress={({ url }) => {
            void handleLinkPress(url);
          }}
          selectable={false}
          {...(row.currentUserId ? { currentUserId: row.currentUserId } : {})}
          {...(isCollapsed ? { numberOfLines: row.collapse.collapsedLines } : {})}
        />
        {readMore}
      </View>
    );
  }

  if (hasBlockMarkdown(row.body.markdown)) {
    return (
      <View className='mb-2.5'>
        <ConversationComposerMarkdownBody
          markdown={row.body.markdown}
          markdownStyle={inlineMarkdownStyle}
          containerStyle={{ maxWidth: inlineContentMaxWidth }}
          onLinkPress={({ url }) => {
            void handleLinkPress(url);
          }}
          selectable={false}
          {...(row.currentUserId ? { currentUserId: row.currentUserId } : {})}
          isOwnMessage={isOwnMessage}
          hydrateInlineEmoji={fidelity === 'full'}
          {...(isCollapsed ? { collapsedNumberOfLines: row.collapse.collapsedLines } : {})}
        />
        {readMore}
      </View>
    );
  }

  if (hasEmojiSegments) {
    return (
      <View className='mb-2.5' style={{ maxWidth: inlineContentMaxWidth }}>
        <View
          style={
            isCollapsed
              ? {
                  maxHeight: PARAGRAPH_LINE_HEIGHT * row.collapse.collapsedLines,
                  overflow: 'hidden',
                }
              : undefined
          }
        >
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
                      style={[TEXT_STYLE, { color: bodyTextColor, flexShrink: 1 }]}
                    >
                      {renderTextSegment(segment, index)}
                    </Text>
                  );
                }

                const uri = segment.uri ?? emojiUris[segment.emojiId] ?? null;
                const label = segment.name ? `:${segment.name}:` : 'custom emoji';

                return (
                  <View key={`${lineIndex}:${index}:${segment.emojiId}`} style={EMOJI_BOX_STYLE}>
                    {fidelity === 'full' && uri ? (
                      <Image
                        source={{ uri }}
                        style={EMOJI_FILL_STYLE}
                        contentFit='contain'
                        cachePolicy='memory-disk'
                        recyclingKey={`${row.conversationId}:${segment.emojiId}`}
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
  }

  return (
    <View className='mb-2.5'>
      <Text
        style={[TEXT_STYLE, { color: bodyTextColor }]}
        {...(isCollapsed ? { numberOfLines: row.collapse.collapsedLines } : {})}
      >
        {segments.map((segment, index) =>
          segment.kind === 'emoji' ? null : renderTextSegment(segment, index),
        )}
      </Text>
      {readMore}
    </View>
  );
};

const MessageRowComponent = ({
  row,
  conversation,
  fidelity,
  currentUser,
  channelType,
  isExpanded = false,
  onExpand,
  onPress,
  onLongPress,
}: MessageRowProps): ReactElement => {
  const renderTokens = useChatRenderTokens();
  const senderColor = colorFromUsernamePalette(
    renderTokens.usernamePalette,
    row.senderPaintModel.senderId,
  );
  const profileActions = useChatUserProfileActionsSheet();
  const isCurrentUser =
    row.senderPaintModel.isCurrentUser || row.senderPaintModel.senderId === currentUser?.id;
  const showIdentity = channelType !== ChannelScopeType.DM;
  const showAvatarSlot = !isCurrentUser && channelType !== ChannelScopeType.DM;
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
  const fixedBubbleStyle =
    isTicketRow || isRecordingRow || row.mediaPlaceholder || hasExpandedBlockBody
      ? { width: renderTokens.inlineContentMaxWidth }
      : undefined;
  const currentUserBubbleStyle = isCurrentUser
    ? { backgroundColor: renderTokens.currentUserBubbleBg }
    : null;
  const showContent =
    !isTicketRow && !isRecordingRow && (row.plainPreviewText.length > 0 || !row.mediaPlaceholder);
  const showReplyBorder =
    row.replyCount > 0 && !isTicketRow && !isRecordingRow && !row.mediaPlaceholder;
  const reactionSummaryCount = row.reactionSummaryCount;
  const hasReactions = reactionSummaryCount > 0;
  // Ticket cards are content-sized. Reserving the estimated row height here pins the
  // card to the bottom of an oversized flex row (`items-end`), which shows as a large
  // blank gap above ticket messages, especially around thread/ticket opens.
  const shouldReserveInnerMinHeight =
    row.rowKind === 'SYSTEM' ||
    !!row.parentPreviewText ||
    (!isTicketRow && !isRecordingRow && hasReactions);
  const reservedInnerMinHeight = shouldReserveInnerMinHeight
    ? Math.max(
        0,
        row.estimatedHeight -
          OUTER_ROW_VERTICAL_PADDING -
          (hasReactions ? CHAT_PAINT_REACTION_SLOT_HEIGHT_PX : 0),
      )
    : undefined;
  const handleSenderIdentityPress = useCallback(
    (event: GestureResponderEvent): void => {
      event.stopPropagation();
      profileActions?.openUserProfileActions({
        userId: row.senderPaintModel.senderId,
        displayName: row.senderPaintModel.displayName,
      });
    },
    [profileActions, row.senderPaintModel.displayName, row.senderPaintModel.senderId],
  );

  if (row.rowKind === 'SYSTEM') {
    if (!row.plainPreviewText.trim()) {
      return <View style={{ height: 8 }} />;
    }
    return (
      <View className='py-1 flex-row justify-center' style={{ minHeight: reservedInnerMinHeight }}>
        <View className='my-4 max-w-[95%] self-center rounded-lg bg-conversation-composer-system-bg p-1.5 light:shadow-[0px_1px_0.5px_0px_rgba(0,0,0,0.06)]'>
          <Text className='text-center text-[12.5px] font-medium leading-5 tracking-[-0.16px] text-conversation-composer-system-text'>
            {row.plainPreviewText}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <Pressable
      className={cn('py-1 flex-row items-end gap-2', justify)}
      style={{
        ...(reservedInnerMinHeight !== undefined ? { minHeight: reservedInnerMinHeight } : {}),
      }}
      disabled={!conversation}
      onPress={onPress}
      onLongPress={conversation ? onLongPress : undefined}
      accessibilityRole='button'
    >
      {showAvatarSlot ? (
        <View
          style={hasReactions ? { marginBottom: CHAT_PAINT_REACTION_SLOT_HEIGHT_PX } : undefined}
        >
          {row.showAvatar ? (
            profileActions && row.senderPaintModel.senderId ? (
              <Pressable
                accessibilityRole='button'
                accessibilityLabel={`Open ${row.senderPaintModel.displayName} profile actions`}
                hitSlop={6}
                onPress={handleSenderIdentityPress}
                style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}
              >
                <Avatar
                  userIds={[row.senderPaintModel.senderId]}
                  fallbackUsers={getSenderAvatarFallbackUsers(row.senderPaintModel)}
                  size={24}
                />
              </Pressable>
            ) : (
              <Avatar
                userIds={row.senderPaintModel.senderId ? [row.senderPaintModel.senderId] : []}
                fallbackUsers={getSenderAvatarFallbackUsers(row.senderPaintModel)}
                size={24}
              />
            )
          ) : (
            <View className='h-6 w-6' />
          )}
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
                ? { onPress: handleSenderIdentityPress }
                : {})}
            />
          ) : null}

          <PaintParentPreview row={row} isCurrentUser={isCurrentUser} />

          {showContent ? (
            <MessageText
              row={row}
              fidelity={fidelity}
              isExpanded={isExpanded}
              {...(onExpand ? { onExpand } : {})}
            />
          ) : null}

          <PaintTicketPreviewCard row={row} isCurrentUser={isCurrentUser} />

          <PaintRecordingPreviewCard row={row} isCurrentUser={isCurrentUser} />

          <LinkPreviewCard
            preview={row.linkPreview}
            isCurrentUser={isCurrentUser}
            mutedForeground={renderTokens.mutedForeground}
            accentColor={renderTokens.ambientAccentColor}
            currentUserColors={{
              backgroundColor: renderTokens.embeddedBgUser,
              titleColor: renderTokens.embeddedTitleUser,
              mutedColor: renderTokens.embeddedMutedUser,
              accentColor: renderTokens.rootAccentUser,
            }}
          />

          {row.mediaPlaceholder ? <PaintMediaPlaceholder media={row.mediaPlaceholder} /> : null}

          <View
            className={cn(
              'flex-row items-end gap-1',
              showReplyBorder ? 'border-t border-border pt-2' : '',
            )}
          >
            <PaintReplyTray row={row} />
            <View className='flex-1' />
            <MessageBookmarkReminderIndicator
              messageId={row.messageId}
              iconColor={isCurrentUser ? renderTokens.rootMetaUser : '#999'}
              {...(isCurrentUser ? { textStyle: { color: renderTokens.rootMetaUser } } : {})}
            />
            <PaintTimeLabel
              messageId={row.messageId}
              timeLabel={row.timeLabel}
              textClass={cn(
                'text-[10px]',
                isCurrentUser ? '' : 'text-conversation-composer-timestamp-other',
              )}
              {...(isCurrentUser ? { color: renderTokens.rootMetaUser } : {})}
            />
          </View>
        </View>
        <PaintReactionSummary
          conversationId={row.conversationId}
          messageId={row.reactionPreview?.messageId}
          groups={row.reactionPreview?.groups}
          reactions={row.reactionPreview?.reactions}
          fallbackCount={reactionSummaryCount}
        />
      </View>
    </Pressable>
  );
};

export const MessageRow = memo(MessageRowComponent);
MessageRow.displayName = 'MessageRow';
