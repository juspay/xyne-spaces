import { memo, useCallback, type ReactElement } from 'react';

import type { ConversationItem } from '@/src/features/chat/v2/components/conversation-composer';

import type { ChatMessageRowRendererProps } from '@/src/features/chat/v2/components/chat/chat-renderers';
import {
  ChatMessageListRow,
  ChatMessageRowShell,
  useChatMessageRowInteractions,
  useChatMessageRowState,
  useInitialMessageFacts,
  type ChatMessageListRowProps,
} from '@/src/features/chat/v2/components/chat/chat-message-list-row';

import { useHoldSource } from '../hooks/use-hold-source';
import { isContinuationRow } from '../model/grouping';
import { usesClassicRow } from '../model/row-policy';
import { FlatMessage } from './flat-message';

/**
 * The channel list's message row in the redesigned layout.
 *
 * Rows the flat layout does not restyle (see `usesClassicRow`) are handed to
 * the classic row untouched; everything else is a `FlatMessage` driven by the
 * classic row's own state and press behaviour.
 */
export const ConversationMessageRow = memo(function ConversationMessageRow({
  previousPaint,
  ...props
}: ChatMessageRowRendererProps): ReactElement {
  const { item, conversation } = props;
  const { isFlowJsonMessage } = useInitialMessageFacts(conversation);

  const classic = usesClassicRow({
    hasConversation: conversation !== undefined,
    rowKind: item.paint.rowKind,
    isTicketActivity: item.paint.isTicketActivity === true,
    hasTicketPreview: !!item.paint.ticketPreview,
    hasRecordingPreview: !!item.paint.recordingPreview,
    isFlowJson: isFlowJsonMessage,
  });

  if (classic || !conversation) return <ChatMessageListRow {...props} />;

  return (
    <FlatRow
      {...props}
      conversation={conversation}
      isContinuation={isContinuationRow(previousPaint, item.paint)}
    />
  );
});

const NOOP = (): void => undefined;

type FlatRowProps = Omit<ChatMessageListRowProps, 'conversation'> & {
  conversation: NonNullable<ChatMessageListRowProps['conversation']>;
  isContinuation: boolean;
};

function FlatRow({
  item,
  channelType,
  targetConversationId,
  animateEntrance,
  currentUser,
  conversation,
  presentationStore,
  handleTargetRowReady,
  isRichRenderingEnabled,
  onRowContentExpanded,
  onMessageLongPress,
  onMessagePress,
  isContinuation,
}: FlatRowProps): ReactElement {
  const { presentation, showRichShell, allowMediaHydration } = useChatMessageRowState({
    item,
    conversation,
    presentationStore,
    isRichRenderingEnabled,
  });
  const flatProps = {
    paintRow: item.paint,
    conversation,
    currentUser,
    channelType,
    isContentExpanded: presentation.expanded,
    onContentExpanded: onRowContentExpanded,
    isRich: showRichShell,
    allowMediaHydration,
    allowInlineEmojiHydration: showRichShell,
    hydrateInlineEmoji: isRichRenderingEnabled || (item.paint.body?.customEmojiIds.length ?? 0) > 0,
    isContinuation,
  };
  // The hold menu lifts a copy of this message: still, and without press handlers.
  const { rowRef, registerHold } = useHoldSource(() => (
    <FlatMessage {...flatProps} onPress={NOOP} />
  ));
  const handleHold = useCallback(
    (held: ConversationItem): void => {
      registerHold(held.conversationId);
      onMessageLongPress(held);
    },
    [onMessageLongPress, registerHold],
  );
  const { handlePress, handleLongPress } = useChatMessageRowInteractions({
    item,
    conversation,
    onMessageLongPress: handleHold,
    onMessagePress,
  });

  const handleThreadPress = useCallback((): void => {
    onMessagePress(conversation, item.paint);
  }, [conversation, item.paint, onMessagePress]);

  return (
    <ChatMessageRowShell
      rowId={item.id}
      targetConversationId={targetConversationId}
      animateEntrance={animateEntrance}
      handleTargetRowReady={handleTargetRowReady}
    >
      <FlatMessage
        {...flatProps}
        rowRef={rowRef}
        onPress={handlePress}
        onLongPress={handleLongPress}
        onThreadPress={handleThreadPress}
      />
    </ChatMessageRowShell>
  );
}
