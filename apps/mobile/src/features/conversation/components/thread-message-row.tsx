import { memo, useCallback, type ReactElement } from 'react';
import { View } from 'react-native';

import type { ThreadMessageRowProps } from '@/src/features/chat/v2/components/chat/chat-renderers';
import { useInitialMessageFacts } from '@/src/features/chat/v2/components/chat/chat-message-list-row';

import { useHoldSource } from '../hooks/use-hold-source';
import { THREAD_LIST_INSET } from '../constants';
import { isContinuationRow } from '../model/grouping';
import { usesClassicRow } from '../model/row-policy';
import { FlatMessage } from './flat-message';

const NOOP = (): void => undefined;

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
  previousPaint,
}: ThreadMessageRowProps): ReactElement {
  const { isFlowJsonMessage } = useInitialMessageFacts(conversation);

  const flatProps = {
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
    isContinuation: isContinuationRow(previousPaint, paintRow, { stripEndsBlock: false }),
  };
  // The hold menu lifts a copy of this message: still, and without press handlers.
  const { rowRef, registerHold } = useHoldSource(() => (
    <FlatMessage {...flatProps} onPress={NOOP} />
  ));
  const handleHold = useCallback((): void => {
    registerHold(conversation.conversationId);
    onLongPress?.();
  }, [conversation.conversationId, onLongPress, registerHold]);

  const classic = usesClassicRow({
    hasConversation: true,
    rowKind: paintRow.rowKind,
    isTicketActivity: paintRow.isTicketActivity === true,
    hasTicketPreview: !!paintRow.ticketPreview,
    hasRecordingPreview: !!paintRow.recordingPreview,
    isFlowJson: isFlowJsonMessage,
  });

  if (classic) return classicContent;

  return (
    // The thread list insets its rows by 12; the flat message carries its own padding.
    <View style={{ marginHorizontal: -THREAD_LIST_INSET }}>
      <FlatMessage
        {...flatProps}
        rowRef={rowRef}
        onPress={onPress}
        onLongPress={onLongPress ? handleHold : undefined}
      />
    </View>
  );
});
