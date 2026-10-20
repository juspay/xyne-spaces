import { Plus } from 'lucide-react-native';
import { memo, useCallback, useMemo, useRef, type ComponentProps, type ReactElement } from 'react';
import { Pressable, View, type BlurEvent, type FocusEvent } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { ChatInput, type ConversationInput } from '@/src/components/input-composer';
import {
  useChatInputActions,
  useChatInputConversation,
  useChatInputHandlers,
  useChatInputText,
} from '@/src/components/input-composer';
import { AgentProgressIndicator } from '@/src/components/chat/agent-progress-indicator';
import { OfflineComposerBanner } from '@/src/components/chat/offline-composer-banner';
import { ComposerScheduleHost } from '@/src/components/input-composer/composer-schedule-host';
import { ComposerTwinAssistHost } from '@/src/components/input-composer/composer-twin-assist-host';
import { useEditComposerSession } from '@/src/components/input-composer/hooks/useEditComposerSession';
import { EDIT_PLACEHOLDER } from '@/src/components/input-composer/conversation-input';
import { getConversationInputComposerKey } from '@/src/components/input-composer/utils/conversation-input.utils';
import { getChatComposerBottomPadding } from '@/src/features/chat/v3/composer/chatKeyboardConfig';

import { useRoomDictation, type RoomDictation } from '../hooks/use-room-dictation';
import { trailingInset, typingBarAction, typingBarPlaceholder } from '../model/typing-bar';
import { RoomTrailing } from './room-trailing';

const noopCancelEdit = (): void => {};
const FIELD_STYLE = { borderRadius: 21 } as const;
const PILL_CLASS = 'py-[9px] pl-4 pr-[3px]';
const PLUS_SIZE = 36;

type RoomTypingBarProps = ComponentProps<typeof ConversationInput>;

/** The "+" plate: opens the same attachments sheet the classic composer's "+" does. */
function RoomAttachButton({ dictation }: { dictation: RoomDictation }): ReactElement | null {
  const { isEditing } = useChatInputConversation();
  const { inputRef } = useChatInputHandlers();
  const { setIsAttachSheetOpenState } = useChatInputActions();
  const color = useCSSVariable('--color-spaces-foreground') as string;
  const opening = useRef(false);

  if (isEditing) return null;

  const open = (): void => {
    if (opening.current) return;
    opening.current = true;
    dictation.interrupt();
    void (async (): Promise<void> => {
      try {
        inputRef.current?.blur();
        await KeyboardController.dismiss();
        setIsAttachSheetOpenState(true);
      } finally {
        opening.current = false;
      }
    })();
  };

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel='Add attachment'
      onPress={open}
      className='items-center justify-center rounded-full bg-spaces-surface active:opacity-60'
      style={{ width: PLUS_SIZE, height: PLUS_SIZE }}
    >
      <Plus size={20} color={color} />
    </Pressable>
  );
}

type RoomFieldProps = {
  dictation: RoomDictation;
  disabled: boolean;
  onFocus: ((e: FocusEvent) => void) | undefined;
  onBlur: ((e: BlurEvent) => void) | undefined;
};

/** The pill: the classic input restyled through its seams, with mic / send inside. */
function RoomField({ dictation, disabled, onFocus, onBlur }: RoomFieldProps): ReactElement {
  const { isEditing, isTwinEditing } = useChatInputConversation();
  const { hasComposerContent } = useChatInputText();

  const action = typingBarAction({
    hasContent: hasComposerContent,
    isEditing: isEditing || isTwinEditing,
    listening: dictation.listening,
  });

  const trailing = <RoomTrailing dictation={dictation} disabled={disabled} />;
  const footer = useMemo(
    () => (
      <View className='w-full flex-row items-center'>
        <ChatInput.Actions />
      </View>
    ),
    [],
  );

  const { onNativeText } = dictation;
  const handleChangeText = useCallback(
    (e: { nativeEvent: { value?: string } }): void => {
      onNativeText(e.nativeEvent.value ?? '');
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
      hideLeadingAttach
      trailingSlot={trailing}
      trailingInset={trailingInset(action)}
      footerSlot={footer}
      onChangeText={handleChangeText}
    />
  );
}

type RoomBarRowProps = Omit<RoomFieldProps, 'dictation'>;

/** The "+" and the pill; owns dictation so both can reach it. */
function RoomBarRow({ disabled, onFocus, onBlur }: RoomBarRowProps): ReactElement {
  const dictation = useRoomDictation();

  return (
    <View className='w-full flex-col gap-2 pl-[14px] pr-4'>
      <ChatInput.EditingBanner />
      <View className='w-full flex-row items-end gap-2'>
        <RoomAttachButton dictation={dictation} />
        <View className='min-w-0 flex-1'>
          <ComposerScheduleHost>
            <ComposerTwinAssistHost>
              <RoomField
                dictation={dictation}
                disabled={disabled}
                onFocus={onFocus}
                onBlur={onBlur}
              />
            </ComposerTwinAssistHost>
          </ComposerScheduleHost>
        </View>
      </View>
      <ChatInput.FormattingPanel />
    </View>
  );
}

/**
 * Figma "Room / Typing bar": a "+" plate and a rounded field with a mic that
 * becomes Send once there is something to send. Every behaviour of the shared
 * composer (drafts, attachments, mentions, formatting, emoji, schedule, edit,
 * also-send, offline, twin assist) is the same composer, restyled.
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
      <ChatInput.MentionsList />

      <View
        className='shrink-0 bg-spaces-background'
        style={{
          paddingBottom: getChatComposerBottomPadding(insets.bottom, includeBottomSafeArea),
          paddingTop: 8,
        }}
      >
        <ChatInput.KeyboardLifecycle />

        <ChatInput.AlsoSendToChannel className='px-4 pb-2' />
        <ChatInput.AttachmentsSheet />
        <ChatInput.EmojiPicker />
        <ChatInput.LinkModal />
        {agentSessionId ? (
          <AgentProgressIndicator
            sessionId={agentSessionId}
            conversationId={agentSessionId}
            channelId={conversationId}
          />
        ) : null}
        <OfflineComposerBanner isEditing={isEditing} />

        <RoomBarRow disabled={disabled} onFocus={onFocus} onBlur={onBlur} />
      </View>
    </ChatInput.Root>
  );
}

export const RoomTypingBar = memo(RoomTypingBarComponent);
RoomTypingBar.displayName = 'RoomTypingBar';

/** The thread's reply bar: the room bar with the thread placeholder ("Reply…") in place of the classic one. */
export function ThreadTypingBar({
  placeholder: _classicPlaceholder,
  ...props
}: ComponentProps<typeof ConversationInput>): ReactElement {
  return <RoomTypingBar {...props} />;
}
