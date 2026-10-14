import { memo, useCallback, useMemo, useState, type ReactElement } from 'react';
import {
  Pressable,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { useCSSVariable } from 'uniwind';

import { useConversationComposer } from './conversation-composer-context';
import { FlowJsonActionRow, FlowJsonMessageParts } from './flow-json-message';
import { ConversationComposerMarkdownBody } from './conversation-composer-markdown-body';
import { htmlToMD, normalizeActivityPreviewMarkdown } from './utils/htmlToMD';
import { buildComposerMarkdownStyle } from './utils/markdownStyle';
import { useMentionPress } from './utils/useMentionPress';
import { DebugBoundary } from './utils/debug-boundary';
import {
  getLongMessageCollapseModel,
  shouldCollapseMessageBody,
} from './utils/longMessageCollapse';
import { useFlowNormalizationOptions } from './utils/useFlowNormalizationOptions';
import { MessageType, parseTicketMd } from '@xyne/shared';
import { useChatRenderTokens } from '@/src/features/chat/v2/components/chat/message-row';
import { CHAT_BUBBLE_HORIZONTAL_PADDING_PX } from '@/src/features/chat/v2/paint/chatPaintSizing';
import { flowDefinitionToMarkdown, parseFlowJsonParts } from '@/src/utils/flowJsonMarkdown';
import { isAgentCardFlow } from '@/src/utils/flowAgentUtils';
import { isPrFlow } from '@/src/utils/flowPrUtils';
import { isCallScheduleFlow } from '@/src/utils/flowCallScheduleUtils';
import { isChartFlow } from '@/src/utils/flowChartUtils';
import { isMcpSuggestFlow } from '@/src/utils/flowMcpSuggestUtils';
import { isDiffFlow } from '@/src/utils/flowDiffUtils';
import { markdownFlavorFor } from '@/src/utils/markdownTable';

const READ_MORE_VERTICAL_GAP = 4;

const Content = memo((): ReactElement | null => {
  const {
    item,
    kind,
    summary,
    forwarded,
    currentUser,
    contentVariant,
    paintRow,
    allowInlineEmojiHydration,
    isContentExpanded,
    onContentExpanded,
    suppressBubblePress,
  } = useConversationComposer();
  const {
    actionPrimaryColor,
    inlineContentMaxWidth,
    linkColor,
    linkColorUser,
    rootTextUser,
    tableBorderColor,
    tableHeaderBg,
  } = useChatRenderTokens();
  const [expandedConversationId, setExpandedConversationId] = useState<string | null>(null);

  const foreground = useCSSVariable(
    contentVariant === 'activity' ? '--color-activity-description' : '--color-foreground',
  ) as string;
  const foregroundMuted = useCSSVariable(
    contentVariant === 'activity' ? '--color-activity-description' : '--color-muted',
  ) as string;
  const cardBg = useCSSVariable('--color-card') as string;
  const brand = useCSSVariable('--color-brand') as string;
  const isCurrentUser = kind === 'CURRENT_USER';
  const resolvedForeground =
    contentVariant === 'primary' && isCurrentUser ? rootTextUser : foreground;
  const resolvedLinkColor =
    contentVariant === 'primary' && isCurrentUser ? linkColorUser : linkColor;
  const readMoreColor =
    contentVariant === 'primary' && isCurrentUser ? actionPrimaryColor : linkColor;
  const handleMentionPress = useMentionPress();
  const flowNormalizationOptions = useFlowNormalizationOptions();

  const rawHtml = !summary
    ? ''
    : summary.msgType === MessageType.FORWARDED
      ? (forwarded?.optionalText ?? '')
      : summary.content;
  const flowParts = useMemo(() => parseFlowJsonParts(rawHtml), [rawHtml]);
  const hasFlowJson = flowParts.some(part => part.type === 'flow');
  const hasPrFlow = flowParts.some(part => part.type === 'flow' && isPrFlow(part.definition));
  const hasCallScheduleFlow = flowParts.some(
    part => part.type === 'flow' && isCallScheduleFlow(part.definition),
  );
  const hasChartFlow = flowParts.some(part => part.type === 'flow' && isChartFlow(part.definition));
  const hasMcpSuggestFlow = flowParts.some(
    part => part.type === 'flow' && isMcpSuggestFlow(part.definition),
  );
  const hasDiffFlow = flowParts.some(part => part.type === 'flow' && isDiffFlow(part.definition));
  const hasAgentCardFlow = flowParts.some(
    part => part.type === 'flow' && isAgentCardFlow(part.definition),
  );
  const paintMarkdown =
    contentVariant === 'primary' && summary?.msgType !== MessageType.FORWARDED
      ? paintRow?.body?.markdown
      : undefined;
  const parsedPaintMarkdown =
    paintMarkdown && paintMarkdown.trim().length > 0 ? paintMarkdown : undefined;
  const markdown = useMemo(
    () =>
      hasFlowJson
        ? flowParts
            .map(part =>
              part.type === 'flow'
                ? flowDefinitionToMarkdown(part.definition, {
                    ...flowNormalizationOptions,
                    omitButtons: true,
                  })
                : htmlToMD(part.html),
            )
            .filter(Boolean)
            .join('\n\n')
        : (parsedPaintMarkdown ?? htmlToMD(rawHtml)),
    [flowParts, hasFlowJson, parsedPaintMarkdown, rawHtml, flowNormalizationOptions],
  );
  const ticketFromMd = useMemo(() => parseTicketMd(item.ticket_md ?? null), [item.ticket_md]);

  // Pixel maxWidth for content inside the bubble's px-2 shell. When the bubble is
  // pinned to inlineContentMaxWidth, this keeps Flow/markdown trees inside padding.
  const { height: windowHeight } = useWindowDimensions();
  const markdownMaxWidth = Math.max(120, inlineContentMaxWidth - CHAT_BUBBLE_HORIZONTAL_PADDING_PX);

  const markdownStyle = useMemo(
    () =>
      buildComposerMarkdownStyle({
        foreground: resolvedForeground,
        foregroundMuted,
        cardBg,
        brand,
        linkColor: resolvedLinkColor,
        tableHeaderBackground: tableHeaderBg,
        tableBorderColor,
        variant: contentVariant,
      }),
    [
      resolvedForeground,
      foregroundMuted,
      cardBg,
      brand,
      resolvedLinkColor,
      tableBorderColor,
      tableHeaderBg,
      contentVariant,
    ],
  );

  // Compute markdown before any early return. Custom emojis stay as `xemoji:...`
  // placeholders - `ConversationComposerMarkdownBody` resolves and renders them.
  const previewMarkdown = useMemo(() => {
    return contentVariant === 'activity' ? normalizeActivityPreviewMarkdown(markdown) : markdown;
  }, [contentVariant, markdown]);

  const markdownFlavor = useMemo(() => markdownFlavorFor(previewMarkdown), [previewMarkdown]);

  const longMessage = useMemo(
    () =>
      getLongMessageCollapseModel({
        markdown: previewMarkdown,
        maxWidth: markdownMaxWidth,
        viewportHeight: windowHeight,
      }),
    [previewMarkdown, markdownMaxWidth, windowHeight],
  );

  // The paint row is the canonical body model for primary chat messages. Use
  // its collapse decision here as well so the paint and rich paths agree.
  const paintRowCollapse =
    contentVariant === 'primary' && parsedPaintMarkdown && paintRow ? paintRow.body.collapse : null;

  const hasTicketPreview = !!paintRow?.ticketPreview || !!ticketFromMd;
  const handleReadMorePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      suppressBubblePress();
      onContentExpanded?.(item.conversationId);
      setExpandedConversationId(item.conversationId);
    },
    [item.conversationId, onContentExpanded, suppressBubblePress],
  );

  const isExpanded = isContentExpanded || expandedConversationId === item.conversationId;
  // Paint collapse is the usual source of truth so paint preview and rich
  // agree. Flow-JSON always promotes to the rich tree, whose chrome (cards,
  // wrapped action rows) is taller than the markdown projection paint used.
  // Union the two so a tall Flow card still gets Read more.
  // Compact interactive / visual Flow cards stay expanded so chrome remains visible.
  const keepFlowExpanded =
    hasPrFlow ||
    hasCallScheduleFlow ||
    hasChartFlow ||
    hasMcpSuggestFlow ||
    hasDiffFlow ||
    hasAgentCardFlow;
  const canCollapse = keepFlowExpanded
    ? false
    : hasFlowJson
      ? shouldCollapseMessageBody(longMessage, kind) || paintRowCollapse?.isCollapsible === true
      : paintRowCollapse
        ? paintRowCollapse.isCollapsible
        : contentVariant === 'primary' && shouldCollapseMessageBody(longMessage, kind);
  const isCollapsed = canCollapse && !isExpanded;
  const collapsedNumberOfLines =
    paintRowCollapse?.collapsedLines ?? longMessage.collapsedNumberOfLines;

  if (kind === 'TICKET' || hasTicketPreview) return null;
  if (!summary) return null;
  if (summary.visibleTo && summary.visibleTo !== currentUser?.id) return null;
  if (!previewMarkdown.trim() && !hasFlowJson) return null;

  const markdownEl = (
    <View>
      {/* The rich Flow renderer has no line-clamp contract. Use its Markdown
          projection for the collapsed preview, then mount the rich tree after
          the user expands it. */}
      {hasFlowJson && !isCollapsed ? (
        <FlowJsonMessageParts
          parts={flowParts}
          markdownStyle={markdownStyle}
          containerStyle={{ maxWidth: markdownMaxWidth }}
          onLinkPress={url => {
            void handleMentionPress(url);
          }}
          {...(currentUser?.id ? { currentUserId: currentUser.id } : {})}
          isOwnMessage={isCurrentUser}
          selectable={false}
          hydrateInlineEmoji={allowInlineEmojiHydration}
        />
      ) : (
        <ConversationComposerMarkdownBody
          markdown={previewMarkdown}
          markdownStyle={markdownStyle}
          containerStyle={{ maxWidth: markdownMaxWidth }}
          onLinkPress={({ url }) => {
            void handleMentionPress(url);
          }}
          selectable={false}
          {...(currentUser?.id ? { currentUserId: currentUser.id } : {})}
          isOwnMessage={isCurrentUser}
          hydrateInlineEmoji={allowInlineEmojiHydration}
          {...(markdownFlavor ? { flavor: markdownFlavor } : {})}
          {...(isCollapsed ? { collapsedNumberOfLines } : {})}
        />
      )}
      {hasFlowJson && isCollapsed
        ? flowParts.map((part, index) =>
            part.type === 'flow' ? (
              <FlowJsonActionRow
                key={
                  typeof part.definition.screenId === 'string' && part.definition.screenId
                    ? part.definition.screenId
                    : `flow-actions-${index}`
                }
                flow={part.definition}
                markdownStyle={markdownStyle}
              />
            ) : null,
          )
        : null}
      {isCollapsed ? (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Read more'
          hitSlop={8}
          onPressIn={event => {
            event.stopPropagation();
            suppressBubblePress();
          }}
          onPress={handleReadMorePress}
          className='self-start'
          style={{ paddingTop: READ_MORE_VERTICAL_GAP, paddingBottom: READ_MORE_VERTICAL_GAP }}
        >
          <Text style={{ color: readMoreColor, fontSize: 15, lineHeight: 20, fontWeight: '600' }}>
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
