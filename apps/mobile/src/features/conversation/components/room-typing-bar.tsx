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
import Animated, { Easing, FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { KeyboardController } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import {
  ChatInput,
  useChatInputActions,
  useChatInputConversation,
  useChatInputPanelState,
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
  TYPING_BAR_CARD_BORDER,
  TYPING_BAR_CARD_MORPH_MS,
  TYPING_BAR_CARD_PADDING_BOTTOM,
  TYPING_BAR_CARD_RADIUS,
  TYPING_BAR_CARD_SHADOW,
  TYPING_BAR_FIELD_PADDING_LEFT,
  TYPING_BAR_FIELD_PADDING_RIGHT,
  TYPING_BAR_FIELD_PADDING_Y,
  TYPING_BAR_ICON_SIZE,
  TYPING_BAR_LINE_HEIGHT,
  TYPING_BAR_MAX_LINES,
  TYPING_BAR_PADDING_TOP,
  TYPING_BAR_PLUS_INSET,
  TYPING_BAR_REPLY_PADDING_Y,
  TYPING_BAR_TOOL_HIT_SLOP,
  TYPING_BAR_TOOL_SIZE,
  TYPING_BAR_TOOLS_SWAP_MS,
  TYPING_BAR_TRAILING_DROP,
  TYPING_BAR_TRAILING_GUTTER,
} from '../constants';
import { ThreadReplyFocus } from './thread-reply-focus';
import { useBarAnchor } from '../hooks/use-bar-anchor';
import { useRoomDictationControls, useRoomDictationStatus } from '../hooks/use-room-dictation';
import { openPlusTray, PLUS_TRAY_CLOSED, type PlusTrayState } from '../model/plus-tray';
import { colorOf } from '../model/token-color';
import { fieldTrailingInset, typingBarAction, typingBarPlaceholder } from '../model/typing-bar';
import { IconButton } from './icon-button';
import { PlusTray } from './plus-tray';
import { RoomAlsoSendRow } from './room-also-send-row';
import { RoomAttachmentStrip } from './room-attachment-strip';
import { RoomDictationProvider } from './room-dictation-provider';
import { RoomEditStrip } from './room-edit-strip';
import { RoomMentions } from './room-mentions';
import { RoomOfflineBanner } from './room-offline-banner';
import { RoomToolRow } from './room-tool-row';
import { RoomTrailing } from './room-trailing';
import { ScheduledPill } from './scheduled-pill';
import { ScheduleTray } from './schedule-tray';

const noopCancelEdit = (): void => {};
const FIELD_STYLE = {
  borderRadius: TYPING_BAR_CARD_RADIUS - TYPING_BAR_CARD_BORDER,
  paddingVertical: TYPING_BAR_FIELD_PADDING_Y,
  paddingLeft: TYPING_BAR_FIELD_PADDING_LEFT,
  paddingRight: TYPING_BAR_FIELD_PADDING_RIGHT,
} as const;
/** Unfocused beside "+": the text starts a gutter after it. */
const FIELD_AFTER_PLUS_STYLE = { ...FIELD_STYLE, paddingLeft: TYPING_BAR_TRAILING_GUTTER } as const;
/** Focused, the tool row's mic / Send sits as near the card's bottom edge as its right. */
const CARD_STYLE = {
  ...FIELD_STYLE,
  paddingBottom: TYPING_BAR_CARD_PADDING_BOTTOM,
} as const;
const FIELD_METRICS: ComposerFieldMetrics = {
  lineHeight: TYPING_BAR_LINE_HEIGHT,
  maxLines: TYPING_BAR_MAX_LINES,
};
/** The card draws the surface, edge and shadow; the field and the schedule host inside it are bare. */
const PILL_CLASS = 'shadow-none';
const FIELD_SURFACE_CLASS = 'bg-transparent';
const FIELD_HOST_CLASS = 'bg-transparent shadow-none';
const FIELD_HOST_STYLE = { borderRadius: TYPING_BAR_CARD_RADIUS - TYPING_BAR_CARD_BORDER } as const;
const CARD_CLASS = 'border border-spaces-outline bg-spaces-background dark:bg-spaces-surface';
const CARD_SHAPE_STYLE = [
  { borderRadius: TYPING_BAR_CARD_RADIUS, borderWidth: TYPING_BAR_CARD_BORDER },
  TYPING_BAR_CARD_SHADOW,
];
/** "+" on the card's single line, hanging to the text's centre as mic / Send does. */
const PLUS_SLOT_STYLE = {
  paddingLeft: TYPING_BAR_PLUS_INSET,
  paddingBottom: TYPING_BAR_FIELD_PADDING_Y - TYPING_BAR_TRAILING_DROP,
} as const;
const CARD_LAYOUT = LinearTransition.duration(TYPING_BAR_CARD_MORPH_MS).easing(Easing.linear);
const PLUS_IN = FadeIn.duration(TYPING_BAR_TOOLS_SWAP_MS);
const PLUS_OUT = FadeOut.duration(TYPING_BAR_TOOLS_SWAP_MS);
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

type PlusTrayControls = {
  tray: PlusTrayState;
  open: () => void;
  handleClosed: () => void;
};

/**
 * The "+" tray. Opening it puts the keyboard away (on iOS keeping the field's
 * focus and caret), so closing the tray can bring the keyboard straight back.
 * The field shows unfocused while the tray is up, on both platforms, and the
 * formatting strip goes, as a blur closes it. Held by the bar row, not the
 * button, since "+" moves between the card's line and its tool row.
 */
function usePlusTray(): PlusTrayControls {
  const { interrupt } = useRoomDictationControls();
  const { setIsMentionOpenState, setIsFormattingVisibleState } = useChatInputActions();
  const [tray, setTray] = useState<PlusTrayState>(PLUS_TRAY_CLOSED);
  // Set at the tap, before the render: a second quick tap must not reopen it
  // and record the keyboard as gone, losing it when the tray closes.
  const trayOpenRef = useRef(false);

  const open = useCallback((): void => {
    if (trayOpenRef.current) return;
    trayOpenRef.current = true;
    interrupt();
    // On iOS the field keeps focus under the tray, which would leave open suggestions behind it.
    setIsMentionOpenState(false);
    setIsFormattingVisibleState(false);
    const keyboardVisible = KeyboardController.isVisible();
    // Not awaited: the tray rises while the keyboard goes.
    if (keyboardVisible) void KeyboardController.dismiss({ keepFocus: TRAY_KEEPS_FIELD_FOCUS });
    setTray(openPlusTray(keyboardVisible));
  }, [interrupt, setIsFormattingVisibleState, setIsMentionOpenState]);
  const handleClosed = useCallback((): void => {
    trayOpenRef.current = false;
    setTray(PLUS_TRAY_CLOSED);
  }, []);

  return { tray, open, handleClosed };
}

/** The "+" tool: a bare glyph like the tool row's, on the card's line or first in its tool row. */
function PlusButton({ expanded, onPress }: { expanded: boolean; onPress: () => void }): ReactElement {
  const color = colorOf(useCSSVariable('--color-spaces-muted'));
  return (
    <IconButton
      label='Add to conversation'
      size={TYPING_BAR_TOOL_SIZE}
      hitSlop={TYPING_BAR_TOOL_HIT_SLOP}
      expanded={expanded}
      onPress={onPress}
    >
      <Plus size={TYPING_BAR_ICON_SIZE} color={color} />
    </IconButton>
  );
}

type RoomFieldProps = {
  disabled: boolean;
  onFocus: ((e: FocusEvent) => void) | undefined;
  onBlur: ((e: BlurEvent) => void) | undefined;
};

type RoomFieldOwnProps = RoomFieldProps & {
  /** The field reads as unfocused (the "+" tray is up, or it has no focus). */
  isOpen: boolean;
  /** "+", or null while editing: on the card's line it sits before the text, open it leads the tool row. */
  plus: ReactElement | null;
};

/**
 * The field: the classic input restyled through its seams, bare inside the
 * card. Unfocused it is one line with mic / Send at its end; focused its text
 * spans the width, over a tool row that holds "+", the tools, the formatting
 * strip and mic / Send. Re-renders when focus, content, the edit mode or the
 * dictation status changes, since each can move the trailing control or its inset.
 */
function RoomField({ disabled, onFocus, onBlur, isOpen, plus }: RoomFieldOwnProps): ReactElement {
  const { isEditing, isTwinEditing } = useChatInputConversation();
  const { hasComposerContent } = useChatInputText();
  const { isLinkModalOpen } = useChatInputPanelState();
  const { setIsFormattingVisibleState } = useChatInputActions();
  const status = useRoomDictationStatus();
  const { onNativeText } = useRoomDictationControls();
  const placeholderColor = colorOf(useCSSVariable('--color-spaces-subtle'));

  const action = typingBarAction({
    hasContent: hasComposerContent,
    isEditing: isEditing || isTwinEditing,
    listening: status === 'listening',
  });

  const trailing = useMemo(() => <RoomTrailing disabled={disabled} />, [disabled]);
  const toolRow = useMemo(
    () => <RoomToolRow disabled={disabled} leadingTool={plus} />,
    [disabled, plus],
  );

  // The next focus opens on the tools, not on a strip left showing (Slack);
  // the link sheet only borrows the focus, so the strip waits for its return.
  const handleBlur = useCallback(
    (e: BlurEvent): void => {
      if (!isLinkModalOpen) setIsFormattingVisibleState(false);
      onBlur?.(e);
    },
    [isLinkModalOpen, onBlur, setIsFormattingVisibleState],
  );

  const handleChangeText = useCallback(
    (e: NativeSyntheticEvent<OnChangeTextEvent>): void => {
      onNativeText(e.nativeEvent.value);
    },
    [onNativeText],
  );

  return (
    <ChatInput.Input
      {...(onFocus ? { onFocus } : {})}
      onBlur={handleBlur}
      disabled={disabled}
      surfaceClassName={FIELD_SURFACE_CLASS}
      className={PILL_CLASS}
      shellStyle={isOpen ? CARD_STYLE : plus ? FIELD_AFTER_PLUS_STYLE : FIELD_STYLE}
      fieldMetrics={FIELD_METRICS}
      placeholderTextColor={placeholderColor}
      hideLeadingAttach
      trailingSlot={isOpen ? null : trailing}
      trailingInset={fieldTrailingInset(action, isOpen)}
      trailingAlign='end'
      footerSlot={isOpen ? toolRow : null}
      attachmentsSlot={ATTACHMENTS}
      onChangeText={handleChangeText}
    />
  );
}

/**
 * The card, under one dictation session "+" and the field can both reach.
 * Unfocused it is one line, "+" then the field; focused it opens, with a linear
 * layout transition, into the text over the tool row, "+" moving to lead it.
 * The mentions card floats above, drawn in its own layer from the row's window
 * rect, so the dock keeps the bar's height.
 */
function RoomBarRow({ disabled, onFocus, onBlur }: RoomFieldProps): ReactElement {
  return (
    <RoomDictationProvider>
      <RoomBarCard disabled={disabled} onFocus={onFocus} onBlur={onBlur} />
    </RoomDictationProvider>
  );
}

function RoomBarCard({ disabled, onFocus, onBlur }: RoomFieldProps): ReactElement {
  const mentionsAnchor = useBarAnchor();
  const { isEditing } = useChatInputConversation();
  const { isInputFocused: hasFocus } = useChatInputPanelState();
  const { tray, open, handleClosed } = usePlusTray();
  const isOpen = hasFocus && !tray.open;
  const plus = useMemo(
    () => (isEditing ? null : <PlusButton expanded={tray.open} onPress={open} />),
    [isEditing, open, tray.open],
  );

  return (
    <>
      <RoomMentions anchor={mentionsAnchor} />
      <View
        ref={mentionsAnchor.ref}
        collapsable={false}
        onLayout={mentionsAnchor.measure}
        className='w-full flex-col gap-2 px-4'
      >
        <RoomEditStrip />
        <Animated.View layout={CARD_LAYOUT} className={CARD_CLASS} style={CARD_SHAPE_STYLE}>
          <ComposerScheduleHost
            className={FIELD_HOST_CLASS}
            style={FIELD_HOST_STYLE}
            SchedulePicker={ScheduleTray}
            ScheduledBannerView={ScheduledPill}
          >
            <View className='w-full flex-row items-end'>
              {plus && !isOpen ? (
                <Animated.View entering={PLUS_IN} exiting={PLUS_OUT} style={PLUS_SLOT_STYLE}>
                  {plus}
                </Animated.View>
              ) : null}
              <View className='min-w-0 flex-1'>
                <ComposerTwinAssistHost>
                  <RoomField
                    disabled={disabled}
                    onFocus={onFocus}
                    onBlur={onBlur}
                    isOpen={isOpen}
                    plus={plus}
                  />
                </ComposerTwinAssistHost>
              </View>
            </View>
          </ComposerScheduleHost>
        </Animated.View>
      </View>
      {tray.open ? <PlusTray heldKeyboard={tray.heldKeyboard} onClosed={handleClosed} /> : null}
    </>
  );
}

/**
 * Figma "Room / Typing bar": a "+" plate and a rounded field with a mic that
 * becomes Send once there is something to send. Drafts, attachments, mentions,
 * schedule, edit, also-send, offline and twin assist are the shared composer,
 * restyled. Attachments and scheduling open from the "+" tray; formatting,
 * emoji, mentions and links from the focused card's tool row.
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
