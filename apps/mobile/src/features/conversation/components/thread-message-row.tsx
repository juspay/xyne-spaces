import { memo, useCallback, type ReactElement } from 'react';
import { View } from 'react-native';
import { usePendingStatusByMessageId } from '@xyne/shared/messages';

import { useLatestRef } from '@/src/components/input-composer/utils/use-latest-ref';
import type { ThreadMessageRowProps } from '@/src/features/chat/v2/components/chat/chat-renderers';
import { useInitialMessageFacts } from '@/src/features/chat/v2/components/chat/chat-message-list-row';

import { useIsContinuation, useRowFlow } from '../hooks/use-agent-plan';
import { useFlatHoldCopy } from '../hooks/use-flat-hold-copy';
import { THREAD_LIST_INSET } from '../constants';
import { isRestyledRow } from '../model/row-policy';
import { FlatMessage, type FlatMessageContentProps } from './flat-message';

/**
 * A message inside the thread screen: root first, replies after, all flat.
 * The thread screen already owns the date rows and the replies divider; this
 * draws only the message. Rows the flat layout skips are the classic thread's
 * own row, handed over whole.
 */
export const ConversationThreadMessageRow = memo(function ConversationThreadMessageRow({
  paintRow,
  conversation,
  currentUser,
  channelType,
  isContentExpanded,
  classicContent,
  showRichContent,
  allowMediaHydration,
  allowInlineEmojiHydration,
  hydrateInlineEmoji,
  onContentExpanded,
  onPress,
  onLongPress,
  onTicketPress,
  previousPaint,
  previousConversation,
  isEditing = false,
}: ThreadMessageRowProps): ReactElement {
  const { plan, isClassicFlow } = useRowFlow(useInitialMessageFacts(conversation));
  const sendStatus = usePendingStatusByMessageId(paintRow.messageId ?? '');
  const isContinuation = useIsContinuation(previousPaint, previousConversation, paintRow, {
    stripEndsBlock: false,
    showsSendStatus: sendStatus !== null,
  });

  const flatProps: FlatMessageContentProps = {
    paintRow,
    conversation,
    currentUser,
    channelType,
    isContentExpanded,
    onContentExpanded,
    isRich: showRichContent,
    allowMediaHydration,
    allowInlineEmojiHydration,
    hydrateInlineEmoji,
    isContinuation,
    plan,
  };
  const { rowRef, registerHold } = useFlatHoldCopy(flatProps);
  // The thread list hands over fresh handlers on every reply; read them through
  // a ref so the memoized message underneath keeps its props and skips the render.
  const handlers = useLatestRef({ onPress, onLongPress, onTicketPress });
  const handlePress = useCallback((): void => handlers.current.onPress(), [handlers]);
  const handleTicketPress = useCallback((): void => handlers.current.onTicketPress?.(), [handlers]);
  const messageId = paintRow.messageId;
  const handleHold = useCallback((): void => {
    registerHold(messageId);
    handlers.current.onLongPress?.();
  }, [handlers, messageId, registerHold]);

  if (!isRestyledRow(paintRow, { isFlowJson: isClassicFlow })) return classicContent;

  return (
    // The thread list insets its rows by 12; the flat message carries its own padding.
    // A message open in the composer for editing is tinted, so it is clear which one changes.
    <View
      className={isEditing ? 'bg-spaces-mention-surface' : ''}
      style={{ marginHorizontal: -THREAD_LIST_INSET }}
    >
      <FlatMessage
        {...flatProps}
        rowRef={rowRef}
        onPress={handlePress}
        onLongPress={onLongPress ? handleHold : undefined}
        onTicketPress={onTicketPress ? handleTicketPress : undefined}
      />
    </View>
  );
});
