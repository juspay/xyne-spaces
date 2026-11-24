import { memo, useCallback, type ReactElement } from 'react';
import { View } from 'react-native';
import { usePendingStatusByMessageId } from '@xyne/shared/messages';

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
  const handleHold = useCallback((): void => {
    registerHold(paintRow.messageId);
    onLongPress?.();
  }, [onLongPress, paintRow.messageId, registerHold]);

  if (!isRestyledRow(paintRow, { isFlowJson: isClassicFlow })) return classicContent;

  return (
    // The thread list insets its rows by 12; the flat message carries its own padding.
    <View style={{ marginHorizontal: -THREAD_LIST_INSET }}>
      <FlatMessage
        {...flatProps}
        rowRef={rowRef}
        onPress={onPress}
        onLongPress={onLongPress ? handleHold : undefined}
        onTicketPress={onTicketPress}
      />
    </View>
  );
});
