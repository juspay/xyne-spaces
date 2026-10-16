import { memo, useCallback, useMemo, useSyncExternalStore, type ReactElement } from 'react';
import {
  Pressable,
  type PressableStateCallbackType,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';
import { ChannelScopeType, MessageType, parseInitialMessageMd, type User } from '@xyne/shared';
import { usePendingByMessageId, usePendingStatusByMessageId } from '@xyne/shared/messages';

import { MessageHighlight } from '@/src/components/chat/message-highlight';
import { haptics } from '@/src/utils/haptics';
import { ChatRowEntrance } from '@/src/features/chat/v2/components/chat/chat-row-entrance';
import { ChatPaintRowLite } from '@/src/features/chat/v2/components/chat/chat-paint-row-lite';
import { MessageRow } from '@/src/features/chat/v2/components/chat/message-row';
import {
  ChatComposer,
  type ConversationItem,
} from '@/src/features/chat/v2/components/conversation-composer';
import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';
import { useZero } from '@/src/hooks/useZero';
import { isFlowJsonHtml } from '@/src/utils/flowJsonMarkdown';
import { shouldKeepChatPaintPreview } from '@/src/features/chat/v2/components/chat/chat-paint-preview-policy';
import { retryPendingMessageFromV2 } from '@/src/features/chat/v2/pendingRetryTelemetry';

export type ChatMessageRow = { type: 'message'; id: string; paint: ChatPaintRow };

type RowPresentation = {
  rich: boolean;
  media: boolean;
  expanded: boolean;
};

export type RowPresentationStore = {
  clear: () => void;
  getSnapshot: (conversationId: string) => RowPresentation;
  expand: (conversationId: string) => boolean;
  promoteRich: (conversationId: string) => boolean;
  promoteMedia: (conversationId: string) => boolean;
  subscribe: (conversationId: string, listener: () => void) => () => void;
};

const EMPTY_ROW_PRESENTATION: RowPresentation = {
  rich: false,
  media: false,
  expanded: false,
};

const PAINT_PRESSABLE_PRESSED_STYLE: ViewStyle = { opacity: 0.7 };

const getPaintPressableStyle = ({ pressed }: PressableStateCallbackType): StyleProp<ViewStyle> =>
  pressed ? PAINT_PRESSABLE_PRESSED_STYLE : null;

type InitialMessageSummary = ReturnType<typeof parseInitialMessageMd>;

const hasSpecialSystemMessageUi = (summary: InitialMessageSummary): boolean => {
  if (!summary?.metadata) return false;

  try {
    const metadata = JSON.parse(summary.metadata) as Record<string, unknown>;
    return (
      metadata['isCallMessage'] === true || metadata['messageSubtype'] === 'user_not_in_channel'
    );
  } catch {
    return false;
  }
};

export const hasHydratableMedia = (row: ChatPaintRow): boolean => {
  const media = row.mediaPlaceholder;
  return (
    !!media && media.attachmentCount > 0 && media.mediaKind !== 'none' && media.mediaKind !== 'file'
  );
};

export const createRowPresentationStore = (): RowPresentationStore => {
  const snapshots = new Map<string, RowPresentation>();
  const listenersById = new Map<string, Set<() => void>>();

  const notify = (conversationId: string): void => {
    const listeners = listenersById.get(conversationId);
    if (!listeners) return;
    for (const listener of listeners) listener();
  };

  return {
    clear: (): void => {
      const ids = Array.from(snapshots.keys());
      snapshots.clear();
      for (const id of ids) notify(id);
    },
    getSnapshot: (conversationId: string): RowPresentation =>
      snapshots.get(conversationId) ?? EMPTY_ROW_PRESENTATION,
    expand: (conversationId: string): boolean => {
      const previous = snapshots.get(conversationId) ?? EMPTY_ROW_PRESENTATION;
      if (previous.expanded) return false;
      snapshots.set(conversationId, {
        ...previous,
        expanded: true,
      });
      notify(conversationId);
      return true;
    },
    promoteRich: (conversationId: string): boolean => {
      const previous = snapshots.get(conversationId) ?? EMPTY_ROW_PRESENTATION;
      if (previous.rich) return false;
      snapshots.set(conversationId, {
        ...previous,
        rich: true,
      });
      notify(conversationId);
      return true;
    },
    promoteMedia: (conversationId: string): boolean => {
      const previous = snapshots.get(conversationId) ?? EMPTY_ROW_PRESENTATION;
      if (previous.media) return false;
      snapshots.set(conversationId, {
        ...previous,
        media: true,
      });
      notify(conversationId);
      return true;
    },
    subscribe: (conversationId: string, listener: () => void): (() => void) => {
      let listeners = listenersById.get(conversationId);
      if (!listeners) {
        listeners = new Set();
        listenersById.set(conversationId, listeners);
      }
      listeners.add(listener);
      return (): void => {
        listeners?.delete(listener);
        if (listeners?.size === 0) {
          listenersById.delete(conversationId);
        }
      };
    },
  };
};

const useRowPresentation = (store: RowPresentationStore, conversationId: string): RowPresentation =>
  useSyncExternalStore(
    useCallback(listener => store.subscribe(conversationId, listener), [conversationId, store]),
    useCallback(() => store.getSnapshot(conversationId), [conversationId, store]),
    () => EMPTY_ROW_PRESENTATION,
  );

type ChatMessageListRowProps = {
  item: ChatMessageRow;
  channelType?: ChannelScopeType | undefined;
  targetConversationId?: string | undefined;
  animateEntrance?: boolean | undefined;
  currentUser: User | undefined;
  conversation: ConversationItem | undefined;
  presentationStore: RowPresentationStore;
  handleTargetRowReady: (rowId: string) => void;
  isRichRenderingEnabled: boolean;
  onRowContentExpanded: (conversationId: string) => void;
  onMessageLongPress: (conversation: ConversationItem) => void;
  onMessagePress: (conversation: ConversationItem, paintRow: ChatPaintRow) => void;
};

export const ChatMessageListRow = memo(function ChatMessageListRow({
  item,
  channelType,
  targetConversationId,
  animateEntrance = false,
  currentUser,
  conversation,
  presentationStore,
  handleTargetRowReady,
  isRichRenderingEnabled,
  onRowContentExpanded,
  onMessageLongPress,
  onMessagePress,
}: ChatMessageListRowProps): ReactElement {
  const zero = useZero();
  const presentation = useRowPresentation(presentationStore, item.paint.conversationId);
  const initialMessageSummary = useMemo(
    () =>
      conversation?.initial_message_md
        ? parseInitialMessageMd(conversation.initial_message_md)
        : null,
    [conversation?.initial_message_md],
  );
  const useStableTicketRow = !!item.paint.ticketPreview;
  const isForwardedMessage = initialMessageSummary?.msgType === MessageType.FORWARDED;
  const isFlowJsonMessage = isFlowJsonHtml(initialMessageSummary?.content ?? '');
  const useSpecialSystemComposer =
    item.paint.rowKind === 'SYSTEM' && hasSpecialSystemMessageUi(initialMessageSummary);
  const useStableSystemRow =
    item.paint.rowKind === 'SYSTEM' && !useSpecialSystemComposer && !isFlowJsonMessage;
  const useMessageRow = useStableTicketRow || useStableSystemRow;
  const shouldKeepPaintPreview = shouldKeepChatPaintPreview({
    isCollapsible: item.paint.collapse.isCollapsible,
    isForwardedMessage,
    isFlowJsonMessage,
    customEmojiCount: item.paint.body?.customEmojiIds.length ?? 0,
    hasMediaPlaceholder: !!item.paint.mediaPlaceholder,
  });
  const showRichShell =
    conversation !== undefined &&
    !shouldKeepPaintPreview &&
    (isFlowJsonMessage || isForwardedMessage || (isRichRenderingEnabled && presentation.rich));
  const allowMediaHydration = showRichShell && (isForwardedMessage || presentation.media);
  const pending = usePendingByMessageId(item.paint.messageId ?? '');
  const pendingStatus = usePendingStatusByMessageId(item.paint.messageId ?? '');
  // Only intercept the tap when there's something for the user to act on
  // (clock or failed icon showing). In-flight healthy sends (status === null)
  // fall through to the normal tap → open thread behaviour.
  const hasVisiblePendingStatus = pendingStatus !== null;
  const handlePress = useCallback((): void => {
    if (!conversation) return;
    if (pending && pendingStatus === 'failed') {
      retryPendingMessageFromV2(zero, pending, 'conversation_message_row');
      return;
    }
    if (pending && hasVisiblePendingStatus) {
      onMessageLongPress(conversation);
      return;
    }
    onMessagePress(conversation, item.paint);
  }, [
    conversation,
    hasVisiblePendingStatus,
    item.paint,
    onMessageLongPress,
    onMessagePress,
    pending,
    pendingStatus,
    zero,
  ]);

  const handleLongPress = useCallback((): void => {
    if (!conversation) return;
    void haptics.longPress();
    onMessageLongPress(conversation);
  }, [conversation, onMessageLongPress]);

  const handleLayout = useCallback((): void => {
    handleTargetRowReady(item.id);
  }, [handleTargetRowReady, item.id]);
  const isTargetRow = targetConversationId === item.id;

  const shouldHydrateInlineEmoji =
    isRichRenderingEnabled || (item.paint.body?.customEmojiIds.length ?? 0) > 0;

  const paintRow = (
    <ChatPaintRowLite
      row={item.paint}
      {...(channelType !== undefined ? { channelType } : {})}
      hydrateInlineEmoji={shouldHydrateInlineEmoji}
      isExpanded={presentation.expanded}
      onExpand={onRowContentExpanded}
    />
  );

  const content =
    useSpecialSystemComposer && conversation ? (
      <ChatComposer
        conversation={conversation}
        {...(channelType !== undefined ? { channelType } : {})}
        currentUser={currentUser}
        paintRow={item.paint}
        allowMediaHydration={false}
        allowInlineEmojiHydration={false}
        isContentExpanded={presentation.expanded}
        onContentExpanded={onRowContentExpanded}
      />
    ) : useMessageRow ? (
      <MessageRow
        row={item.paint}
        conversation={conversation}
        fidelity={showRichShell ? 'full' : 'reserved'}
        currentUser={currentUser}
        {...(channelType !== undefined ? { channelType } : {})}
        isExpanded={presentation.expanded}
        onExpand={onRowContentExpanded}
        onLongPress={handleLongPress}
        onPress={handlePress}
      />
    ) : showRichShell && conversation ? (
      <ChatComposer
        conversation={conversation}
        {...(channelType !== undefined ? { channelType } : {})}
        currentUser={currentUser}
        onPress={handlePress}
        onLongPress={handleLongPress}
        paintRow={item.paint}
        allowMediaHydration={allowMediaHydration}
        allowInlineEmojiHydration={showRichShell}
        isContentExpanded={presentation.expanded}
        onContentExpanded={onRowContentExpanded}
      />
    ) : (
      <Pressable
        disabled={conversation === undefined}
        onLongPress={handleLongPress}
        onPress={handlePress}
        style={getPaintPressableStyle}
      >
        {paintRow}
      </Pressable>
    );
  const paddedContent = (
    <View key={item.id} className='px-4 py-1'>
      {content}
    </View>
  );
  const rowContent = isTargetRow ? (
    <MessageHighlight enabled>{paddedContent}</MessageHighlight>
  ) : (
    paddedContent
  );

  return (
    <View {...(isTargetRow ? { onLayout: handleLayout } : {})}>
      {animateEntrance ? <ChatRowEntrance>{rowContent}</ChatRowEntrance> : rowContent}
    </View>
  );
});
