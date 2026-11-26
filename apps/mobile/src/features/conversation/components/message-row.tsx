import { memo, useCallback, useMemo, type ReactElement } from 'react';
import { View, type AccessibilityActionEvent, type AccessibilityActionInfo } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { getStatus, usePendingByMessageId } from '@xyne/shared/messages';

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

import { useIsContinuation, useRowFlow } from '../hooks/use-agent-plan';
import { useFlatHoldCopy } from '../hooks/use-flat-hold-copy';
import type { AgentPlan } from '../model/agent-plan';
import { isRestyledRow, isUnreadableMessage } from '../model/row-policy';
import { swipeDirections, type SwipeActionId } from '../model/swipe-actions';
import { useConversationCanReact } from './conversation-palette';
import { FlatMessage, type FlatMessageContentProps } from './flat-message';
import { SwipeActions } from './swipe-actions';
import { useRunSwipeAction } from './swipe-action-runner';

/**
 * The channel list's message row in the redesigned layout.
 *
 * Rows the flat layout does not restyle (see `isRestyledRow`) are handed to
 * the classic row untouched; everything else is a `FlatMessage` driven by the
 * classic row's own state and press behaviour.
 */
export const ConversationMessageRow = memo(function ConversationMessageRow({
  previousPaint,
  previousConversation,
  ...props
}: ChatMessageRowRendererProps): ReactElement {
  const { item, conversation } = props;
  const facts = useInitialMessageFacts(conversation);
  const { initialMessageSummary } = facts;
  const { plan, isClassicFlow } = useRowFlow(facts);

  if (conversation && isUnreadableMessage(conversation.initial_message_md)) return <View />;
  if (!conversation || !isRestyledRow(item.paint, { isFlowJson: isClassicFlow })) {
    return <ChatMessageListRow {...props} />;
  }

  return (
    <FlatRow
      {...props}
      conversation={conversation}
      previousPaint={previousPaint}
      previousConversation={previousConversation}
      plan={plan}
      isShownInChannel={initialMessageSummary?.showInChannel === true}
    />
  );
});

const REPLY_ACTION: AccessibilityActionInfo = { name: 'replyInThread', label: 'Reply in thread' };
const ASK_AI_ACTION: AccessibilityActionInfo = { name: 'askAI', label: 'Ask AI' };
const ACTION_BY_NAME: Readonly<Record<string, SwipeActionId>> = {
  [REPLY_ACTION.name]: 'reply-in-thread',
  [ASK_AI_ACTION.name]: 'ask-ai',
};

type FlatRowProps = Omit<ChatMessageListRowProps, 'conversation'> & {
  conversation: NonNullable<ChatMessageListRowProps['conversation']>;
  previousPaint: ChatMessageRowRendererProps['previousPaint'];
  previousConversation: ChatMessageRowRendererProps['previousConversation'];
  plan: AgentPlan | null;
  /** A thread reply also sent to the room: it offers no reply swipe, as its thread is the parent's. */
  isShownInChannel: boolean;
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
  previousPaint,
  previousConversation,
  plan,
  isShownInChannel,
}: FlatRowProps): ReactElement {
  const { presentation, showRichShell, allowMediaHydration } = useChatMessageRowState({
    item,
    conversation,
    presentationStore,
    isRichRenderingEnabled,
  });
  const pending = usePendingByMessageId(item.paint.messageId ?? '');
  const isContinuation = useIsContinuation(previousPaint, previousConversation, item.paint, {
    showsSendStatus: pending !== null && getStatus(pending) !== null,
  });
  const flatProps: FlatMessageContentProps = {
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
    plan,
  };
  const { rowRef, registerHold } = useFlatHoldCopy(flatProps);
  // The hold menu takes the touch from here; a drag that follows must not swipe the row.
  const swipeHeld = useSharedValue(false);
  const handleHold = useCallback(
    (held: ConversationItem): void => {
      swipeHeld.set(true);
      registerHold(item.paint.messageId);
      onMessageLongPress(held);
    },
    [item.paint.messageId, onMessageLongPress, registerHold, swipeHeld],
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

  const runSwipeAction = useRunSwipeAction();
  const canReact = useConversationCanReact();
  const isPending = pending !== null;
  const directions = useMemo(
    () =>
      swipeDirections({
        canAct: canReact && runSwipeAction !== null,
        isPending,
        isDeleted: !!item.paint.isDeleted,
        isShownInChannel,
      }),
    [canReact, isPending, isShownInChannel, item.paint.isDeleted, runSwipeAction],
  );
  const handleSwipeAction = useCallback(
    (action: SwipeActionId): void => runSwipeAction?.(conversation, action),
    [conversation, runSwipeAction],
  );
  const accessibilityActions = useMemo(
    () => [
      ...(directions.reply ? [REPLY_ACTION] : []),
      ...(directions.askAI ? [ASK_AI_ACTION] : []),
    ],
    [directions],
  );
  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent): void => {
      const action = ACTION_BY_NAME[event.nativeEvent.actionName];
      if (action) handleSwipeAction(action);
    },
    [handleSwipeAction],
  );

  return (
    <ChatMessageRowShell
      rowId={item.id}
      targetConversationId={targetConversationId}
      animateEntrance={animateEntrance}
      handleTargetRowReady={handleTargetRowReady}
    >
      <SwipeActions
        directions={directions}
        onCommit={handleSwipeAction}
        held={swipeHeld}
        isContinuation={isContinuation}
      >
        <FlatMessage
          {...flatProps}
          rowRef={rowRef}
          onPress={handlePress}
          onLongPress={handleLongPress}
          onThreadPress={handleThreadPress}
          {...(accessibilityActions.length > 0
            ? { accessibilityActions, onAccessibilityAction: handleAccessibilityAction }
            : {})}
        />
      </SwipeActions>
    </ChatMessageRowShell>
  );
}
