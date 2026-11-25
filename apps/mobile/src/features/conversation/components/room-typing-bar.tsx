import { Plus } from 'lucide-react-native';
import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
} from 'react';
import {
  Platform,
  View,
  type BlurEvent,
  type FocusEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import type { OnChangeTextEvent } from 'react-native-enriched';
import { KeyboardController } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import {
  ChatInput,
  useChatInputActions,
  useChatInputConversation,
  useChatInputText,
  type ConversationInput,
} from '@/src/components/input-composer';
import type { ComposerFieldMetrics } from '@/src/components/input-composer/composer-input-typography';
import { AgentProgressIndicator } from '@/src/components/chat/agent-progress-indicator';
import { OfflineComposerBanner } from '@/src/components/chat/offline-composer-banner';
import { ComposerScheduleHost } from '@/src/components/input-composer/composer-schedule-host';
import { ComposerTwinAssistHost } from '@/src/components/input-composer/composer-twin-assist-host';
import { useEditComposerSession } from '@/src/components/input-composer/hooks/useEditComposerSession';
import { EDIT_PLACEHOLDER } from '@/src/components/input-composer/conversation-input';
import { getConversationInputComposerKey } from '@/src/components/input-composer/utils/conversation-input.utils';
import { getChatComposerBottomPadding } from '@/src/features/chat/v2/chatKeyboardConfig';

import {
  TYPING_BAR_FIELD_PADDING_LEFT,
  TYPING_BAR_FIELD_PADDING_RIGHT,
  TYPING_BAR_FIELD_PADDING_Y,
  TYPING_BAR_FIELD_RADIUS,
  TYPING_BAR_ICON_SIZE,
  TYPING_BAR_LINE_HEIGHT,
  TYPING_BAR_MAX_LINES,
  TYPING_BAR_PADDING_TOP,
  TYPING_BAR_PLUS_SIZE,
  TYPING_BAR_REPLY_PADDING_Y,
} from '../constants';
import { ThreadReplyFocus } from './thread-reply-focus';
import { useBarAnchor } from '../hooks/use-bar-anchor';
import { useRoomDictationControls, useRoomDictationStatus } from '../hooks/use-room-dictation';
import { openPlusTray, PLUS_TRAY_CLOSED, type PlusTrayState } from '../model/plus-tray';
import { colorOf } from '../model/token-color';
import { trailingInset, typingBarAction, typingBarPlaceholder } from '../model/typing-bar';
import { IconButton } from './icon-button';
import { PlusTray } from './plus-tray';
import { RoomAlsoSendRow } from './room-also-send-row';
import { RoomAttachmentStrip } from './room-attachment-strip';
import { RoomDictationProvider } from './room-dictation-provider';
import { RoomEditStrip } from './room-edit-strip';
import { RoomMentions } from './room-mentions';
import { RoomOfflineBanner } from './room-offline-banner';
import { RoomTrailing } from './room-trailing';
import { ScheduledPill } from './scheduled-pill';
import { ScheduleTray } from './schedule-tray';

const noopCancelEdit = (): void => {};
const FIELD_STYLE = {
  borderRadius: TYPING_BAR_FIELD_RADIUS,
  paddingVertical: TYPING_BAR_FIELD_PADDING_Y,
  paddingLeft: TYPING_BAR_FIELD_PADDING_LEFT,
  paddingRight: TYPING_BAR_FIELD_PADDING_RIGHT,
} as const;
const FIELD_METRICS: ComposerFieldMetrics = {
  lineHeight: TYPING_BAR_LINE_HEIGHT,
  maxLines: TYPING_BAR_MAX_LINES,
};
/** Figma's field is flat: no shadow on the pill or on the schedule host that wraps it. */
const PILL_CLASS = 'shadow-none';
const FIELD_HOST_CLASS = 'bg-spaces-surface shadow-none';
const FIELD_HOST_STYLE = { borderRadius: TYPING_BAR_FIELD_RADIUS } as const;
/** The draft's attachments, as tiles inside the field. */
const ATTACHMENTS = <RoomAttachmentStrip />;

type RoomTypingBarProps = ComponentProps<typeof ConversationInput> & {
  /** The thread card's reply bar: its own padding, none of the screen's safe area. */
  reply?: boolean;
};

/**
 * Whether the field keeps its focus while the tray holds the keyboard. Only
 * iOS can bring a kept field's keyboard back; Android lets go of the field and
 * focuses it again when the tray closes.
 */
const TRAY_KEEPS_FIELD_FOCUS = Platform.OS === 'ios';

/**
 * The "+" plate. It opens the tray over the bar, putting the keyboard away
 * (on iOS keeping the field's focus and caret), so closing the tray can bring
 * the keyboard straight back.
 */
function RoomAttachButton(): ReactElement | null {
  const { isEditing } = useChatInputConversation();
  const { interrupt } = useRoomDictationControls();
  const { setIsMentionOpenState } = useChatInputActions();
  const [tray, setTray] = useState<PlusTrayState>(PLUS_TRAY_CLOSED);
  const color = colorOf(useCSSVariable('--color-spaces-muted'));
  // Set at the tap, before the render: a second quick tap must not reopen it
  // and record the keyboard as gone, losing it when the tray closes.
  const trayOpenRef = useRef(false);

  const open = useCallback((): void => {
    if (trayOpenRef.current) return;
    trayOpenRef.current = true;
    interrupt();
    // On iOS the field keeps focus under the tray, which would leave open suggestions behind it.
    setIsMentionOpenState(false);
    const keyboardVisible = KeyboardController.isVisible();
    // Not awaited: the tray rises while the keyboard goes.
    if (keyboardVisible) void KeyboardController.dismiss({ keepFocus: TRAY_KEEPS_FIELD_FOCUS });
    setTray(openPlusTray(keyboardVisible));
  }, [interrupt, setIsMentionOpenState]);
  const handleClosed = useCallback((): void => {
    trayOpenRef.current = false;
    setTray(PLUS_TRAY_CLOSED);
  }, []);

  if (isEditing) return null;

  return (
    <>
      <IconButton
        label='Add to conversation'
        size={TYPING_BAR_PLUS_SIZE}
        expanded={tray.open}
        onPress={open}
        className='bg-spaces-surface'
      >
        <Plus size={TYPING_BAR_ICON_SIZE} color={color} />
      </IconButton>
      {tray.open ? <PlusTray heldKeyboard={tray.heldKeyboard} onClosed={handleClosed} /> : null}
    </>
  );
}

type RoomFieldProps = {
  disabled: boolean;
  onFocus: ((e: FocusEvent) => void) | undefined;
  onBlur: ((e: BlurEvent) => void) | undefined;
};

/**
 * The pill: the classic input restyled through its seams, with mic / send
 * inside and no focused toolbar (formatting opens from the "+" tray).
 * Re-renders when the field gains or loses content, the edit mode or the
 * dictation status changes, since each can swap the trailing control and its inset.
 */
function RoomField({ disabled, onFocus, onBlur }: RoomFieldProps): ReactElement {
  const { isEditing, isTwinEditing } = useChatInputConversation();
  const { hasComposerContent } = useChatInputText();
  const status = useRoomDictationStatus();
  const { onNativeText } = useRoomDictationControls();
  const placeholderColor = colorOf(useCSSVariable('--color-spaces-subtle'));

  const action = typingBarAction({
    hasContent: hasComposerContent,
    isEditing: isEditing || isTwinEditing,
    listening: status === 'listening',
  });

  const trailing = useMemo(() => <RoomTrailing disabled={disabled} />, [disabled]);

  const handleChangeText = useCallback(
    (e: NativeSyntheticEvent<OnChangeTextEvent>): void => {
      onNativeText(e.nativeEvent.value);
    },
    [onNativeText],
  );

  return (
    <ChatInput.Input
      {...(onFocus ? { onFocus } : {})}
      {...(onBlur ? { onBlur } : {})}
      disabled={disabled}
      surfaceClassName='bg-spaces-surface'
      className={PILL_CLASS}
      shellStyle={FIELD_STYLE}
      fieldMetrics={FIELD_METRICS}
      placeholderTextColor={placeholderColor}
      hideLeadingAttach
      trailingSlot={trailing}
      trailingInset={trailingInset(action)}
      trailingAlign='end'
      footerSlot={null}
      attachmentsSlot={ATTACHMENTS}
      onChangeText={handleChangeText}
    />
  );
}

/**
 * The "+" and the pill, under one dictation session both can reach. The
 * mentions card floats above this row, drawn in its own layer from the row's
 * window rect, so the dock keeps the bar's height.
 */
function RoomBarRow({ disabled, onFocus, onBlur }: RoomFieldProps): ReactElement {
  const mentionsAnchor = useBarAnchor();

  return (
    <RoomDictationProvider>
      <RoomMentions anchor={mentionsAnchor} />
      <View
        ref={mentionsAnchor.ref}
        collapsable={false}
        onLayout={mentionsAnchor.measure}
        className='w-full flex-col gap-2 px-4'
      >
        <RoomEditStrip />
        <ChatInput.FormattingPanel />
        <View className='w-full flex-row items-end gap-2'>
          <RoomAttachButton />
          <View className='min-w-0 flex-1'>
            <ComposerScheduleHost
              className={FIELD_HOST_CLASS}
              style={FIELD_HOST_STYLE}
              SchedulePicker={ScheduleTray}
              ScheduledBannerView={ScheduledPill}
            >
              <ComposerTwinAssistHost>
                <RoomField disabled={disabled} onFocus={onFocus} onBlur={onBlur} />
              </ComposerTwinAssistHost>
            </ComposerScheduleHost>
          </View>
        </View>
      </View>
    </RoomDictationProvider>
  );
}

/**
 * Figma "Room / Typing bar": a "+" plate and a rounded field with a mic that
 * becomes Send once there is something to send. Drafts, attachments, mentions,
 * schedule, edit, also-send, offline and twin assist are the shared composer,
 * restyled. Attachments, emoji, formatting and scheduling open from the "+"
 * tray; formatting shows as the shared strip above the field.
 */
function RoomTypingBarComponent({
  conversationId,
  threadId,
  onSend,
  disabled = false,
  placeholder,
  editingMessage = null,
  onCancelEdit,
  onFocus,
  onBlur,
  includeBottomSafeArea = true,
  reply = false,
}: RoomTypingBarProps): ReactElement {
  const insets = useSafeAreaInsets();
  const isEditing = editingMessage !== null;
  const editSession = useEditComposerSession(editingMessage);
  const composerKey = getConversationInputComposerKey(conversationId, threadId, editSession);
  const agentSessionId = threadId?.trim() ? threadId.trim() : undefined;
  const resolvedPlaceholder = typingBarPlaceholder(placeholder, threadId) ?? 'Type a message...';

  return (
    <ChatInput.Root
      key={composerKey}
      conversationId={conversationId}
      onSend={onSend}
      placeholder={isEditing ? EDIT_PLACEHOLDER : resolvedPlaceholder}
      suppressDraftSync={isEditing}
      editingMessage={editingMessage}
      threadId={threadId ?? ''}
      onCancelEdit={onCancelEdit ?? noopCancelEdit}
    >
      <View
        className='shrink-0 bg-spaces-background'
        style={{
          paddingBottom: reply
            ? TYPING_BAR_REPLY_PADDING_Y
            : getChatComposerBottomPadding(insets.bottom, includeBottomSafeArea),
          paddingTop: reply ? TYPING_BAR_REPLY_PADDING_Y : TYPING_BAR_PADDING_TOP,
        }}
      >
        <ChatInput.KeyboardLifecycle />
        {reply ? <ThreadReplyFocus /> : null}

        <RoomAlsoSendRow />
        <ChatInput.EmojiPicker />
        <ChatInput.LinkModal />
        {agentSessionId ? (
          <AgentProgressIndicator
            sessionId={agentSessionId}
            conversationId={agentSessionId}
            channelId={conversationId}
          />
        ) : null}
        <OfflineComposerBanner isEditing={isEditing} View={RoomOfflineBanner} />

        <RoomBarRow disabled={disabled} onFocus={onFocus} onBlur={onBlur} />
      </View>
    </ChatInput.Root>
  );
}

export const RoomTypingBar = memo(RoomTypingBarComponent);
RoomTypingBar.displayName = 'RoomTypingBar';

/** The thread card's reply bar: the room bar with the thread placeholder ("Reply…") and the reply padding. */
export function ThreadTypingBar({
  placeholder: _classicPlaceholder,
  ...props
}: ComponentProps<typeof ConversationInput>): ReactElement {
  return <RoomTypingBar {...props} reply />;
}
