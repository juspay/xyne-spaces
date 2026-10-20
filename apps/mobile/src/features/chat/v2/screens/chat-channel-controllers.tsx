import {
  ReactElement,
  type ComponentType,
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { SharedValue } from 'react-native-reanimated';
import type { ChannelScopeType } from '@xyne/shared';

import { ChatComposerScrollToBottomButton } from '@/src/features/chat/v2/components/chat/chat-composer-dock';
import { type ConversationItem } from '@/src/features/chat/v2/components/conversation-composer';
import type { ChatInputEditingMessage } from '@/src/components/input-composer/input-composer.types';
import {
  conversationItemToActionsTarget,
  MessageActionsSheet,
  type MessageActionsSheetHandle,
  MessageReminderOptionsSheet,
  type MessageActionsTarget,
  type MessageActionsViewProps,
  useMessageActions,
} from '@/src/features/chat/v2/components/message-actions-sheet';

export type ScrollToBottomButtonControllerHandle = {
  setVisible: (visible: boolean) => void;
};

export type ScrollToBottomButtonControllerProps = {
  composerHeight: SharedValue<number>;
  enabled: boolean;
  onPress: () => void;
};

export const ScrollToBottomButtonController = forwardRef<
  ScrollToBottomButtonControllerHandle,
  ScrollToBottomButtonControllerProps
>(function ScrollToBottomButtonController(
  { composerHeight, enabled, onPress },
  ref,
): ReactElement | null {
  const [visible, setVisible] = useState(false);
  useImperativeHandle(
    ref,
    () => ({
      setVisible: (nextVisible: boolean): void => {
        setVisible(currentVisible =>
          currentVisible === nextVisible ? currentVisible : nextVisible,
        );
      },
    }),
    [],
  );

  return (
    <ChatComposerScrollToBottomButton
      composerHeight={composerHeight}
      enabled={enabled}
      onPress={onPress}
      visible={visible}
    />
  );
});

export type ChatChannelMessageActionsControllerHandle = {
  open: (conversation: ConversationItem) => void;
};

export type ChatChannelMessageActionsControllerProps = {
  currentUserId: string | undefined;
  isChannelArchived: boolean;
  channelName?: string | undefined;
  channelScopeType?: ChannelScopeType | undefined;
  disabled: boolean;
  onEditInChat: (payload: ChatInputEditingMessage) => void;
  onBeforeMarkUnread: () => void;
  onMarkUnreadFailure: () => void;
  onActionsOpenChange?: (open: boolean) => void;
  onActionsDismiss?: () => void;
  /** Optional replacement for the bottom-sheet actions view. Unset keeps the classic sheet. */
  actionsView?: ComponentType<MessageActionsViewProps> | undefined;
};

type MountedMessageActionsProps = Omit<ChatChannelMessageActionsControllerProps, 'disabled'> & {
  conversation: ConversationItem | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

const MountedMessageActions = memo(function MountedMessageActions({
  conversation,
  isOpen,
  onOpenChange,
  currentUserId,
  isChannelArchived,
  channelName,
  channelScopeType,
  onEditInChat,
  onBeforeMarkUnread,
  onMarkUnreadFailure,
  onActionsDismiss,
  actionsView,
}: MountedMessageActionsProps): ReactElement {
  const sheetRef = useRef<MessageActionsSheetHandle>(null);
  const [reminderTarget, setReminderTarget] = useState<MessageActionsTarget | null>(null);
  const [isReminderSheetOpen, setIsReminderSheetOpen] = useState(false);
  const target = useMemo(
    () =>
      conversation
        ? conversationItemToActionsTarget(conversation, currentUserId, {
            isChannelArchived,
            channelName,
            channelScopeType,
          })
        : null,
    [channelName, channelScopeType, conversation, currentUserId, isChannelArchived],
  );
  const closeActionSheet = useCallback(
    (afterDismiss?: () => void): void => sheetRef.current?.closeActionSheet(afterDismiss),
    [],
  );
  const openForward = useCallback((): void => sheetRef.current?.openForward(), []);
  const openReminderOptions = useCallback((nextTarget: MessageActionsTarget): void => {
    setReminderTarget(nextTarget);
    setIsReminderSheetOpen(true);
  }, []);
  const handleReminderSheetOpenChange = useCallback((open: boolean): void => {
    setIsReminderSheetOpen(open);
    if (!open) setReminderTarget(null);
  }, []);
  const actions = useMessageActions({
    target,
    currentUserId,
    context: 'channel',
    closeActionSheet,
    openForward,
    openReminderOptions,
    onEditInChat,
    onBeforeMarkUnread,
    onMarkUnreadFailure,
  });

  return (
    <>
      <MessageActionsSheet
        ref={sheetRef}
        target={target}
        actions={actions}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        onDismiss={onActionsDismiss}
        currentUserId={currentUserId}
        {...(actionsView ? { actionsView } : {})}
      />
      <MessageReminderOptionsSheet
        target={reminderTarget}
        isOpen={isReminderSheetOpen}
        onOpenChange={handleReminderSheetOpenChange}
        currentUserId={currentUserId}
      />
    </>
  );
});

export const ChatChannelMessageActionsController = forwardRef<
  ChatChannelMessageActionsControllerHandle,
  ChatChannelMessageActionsControllerProps
>(function ChatChannelMessageActionsController(
  { disabled, onActionsOpenChange, ...mountedProps },
  ref,
): ReactElement | null {
  const [conversation, setConversation] = useState<ConversationItem | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const effectiveOpen = isOpen && !disabled;

  useImperativeHandle(
    ref,
    () => ({
      open: (nextConversation: ConversationItem): void => {
        if (disabled) return;
        setConversation(nextConversation);
        setIsOpen(true);
      },
    }),
    [disabled],
  );

  useEffect(() => {
    if (disabled) setIsOpen(false);
  }, [disabled]);

  useLayoutEffect(() => {
    onActionsOpenChange?.(effectiveOpen);
  }, [effectiveOpen, onActionsOpenChange]);

  const handleOpenChange = useCallback((open: boolean): void => setIsOpen(open), []);

  return (
    <MountedMessageActions
      {...mountedProps}
      conversation={conversation}
      isOpen={effectiveOpen}
      onOpenChange={handleOpenChange}
    />
  );
});
