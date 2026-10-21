import { memo, useMemo, type ReactElement } from 'react';
import { View, type FocusEvent, type BlurEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatInput } from './input-composer';
import type { ChatInputEditingMessage, ChatInputSendHandler } from './input-composer.types';
import { useEditComposerSession } from './hooks/useEditComposerSession';
import { getConversationInputComposerKey } from './utils/conversation-input.utils';
import { chatOpenProfiler } from '@/src/features/chat/chatOpenProfiler';
import { COMPOSER_INPUT_LINE_HEIGHT } from './composer-input-typography';
import { OfflineComposerBanner } from '@/src/components/chat/offline-composer-banner';
import { AgentProgressIndicator } from '@/src/components/chat/agent-progress-indicator';
import { ComposerScheduleHost } from './composer-schedule-host';
import { ComposerTwinAssistHost } from './composer-twin-assist-host';
import {
  CHAT_COMPOSER_FIELD_VERTICAL_PADDING,
  CHAT_COMPOSER_SURFACE_TOP_PADDING,
  getChatComposerBottomPadding,
} from '@/src/features/chat/v3/composer/chatKeyboardConfig';

const DEFAULT_PLACEHOLDER = 'Type a message...';
const EDIT_PLACEHOLDER = 'Edit message…';
const noopCancelEdit = (): void => {};

export const getConversationInputMinimumHeight = (
  safeAreaBottom: number,
  includeBottomSafeArea = true,
): number =>
  Math.ceil(
    getChatComposerBottomPadding(safeAreaBottom, includeBottomSafeArea) +
      CHAT_COMPOSER_SURFACE_TOP_PADDING +
      CHAT_COMPOSER_FIELD_VERTICAL_PADDING +
      COMPOSER_INPUT_LINE_HEIGHT,
  );

export type ConversationInputProps = {
  conversationId: string;
  threadId?: string;
  onSend: ChatInputSendHandler;
  disabled?: boolean;
  placeholder?: string;
  editingMessage?: ChatInputEditingMessage | null;
  onCancelEdit?: () => void;
  onFocus?: (e: FocusEvent) => void;
  onBlur?: (e: BlurEvent) => void;
  includeBottomSafeArea?: boolean;
};

function ConversationInputComponent({
  conversationId,
  threadId,
  onSend,
  disabled = false,
  placeholder = DEFAULT_PLACEHOLDER,
  editingMessage = null,
  onCancelEdit,
  onFocus,
  onBlur,
  includeBottomSafeArea = true,
}: ConversationInputProps): ReactElement {
  chatOpenProfiler.count('conversation_input_render');
  const insets = useSafeAreaInsets();

  const isEditing = editingMessage !== null;
  const editSession = useEditComposerSession(editingMessage);

  const composerKey = getConversationInputComposerKey(conversationId, threadId, editSession);
  const agentSessionId = threadId?.trim() ? threadId.trim() : undefined;

  const inputProps = useMemo(() => {
    const next: { onFocus?: (e: FocusEvent) => void; onBlur?: (e: BlurEvent) => void } = {};
    if (onFocus) next.onFocus = onFocus;
    if (onBlur) next.onBlur = onBlur;
    return next;
  }, [onBlur, onFocus]);

  return (
    <ChatInput.Root
      key={composerKey}
      conversationId={conversationId}
      onSend={onSend}
      placeholder={isEditing ? EDIT_PLACEHOLDER : placeholder}
      suppressDraftSync={isEditing}
      editingMessage={editingMessage}
      threadId={threadId ?? ''}
      onCancelEdit={onCancelEdit ?? noopCancelEdit}
    >
      <ChatInput.MentionsList />

      <View
        className='shrink-0 bg-conversation-input-surface'
        style={{
          paddingBottom: getChatComposerBottomPadding(insets.bottom, includeBottomSafeArea),
          paddingTop: CHAT_COMPOSER_SURFACE_TOP_PADDING,
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

        <View className='w-full flex-col gap-2 px-3'>
          <ChatInput.EditingBanner />
          <View className='w-full flex-col gap-2'>
            <ComposerScheduleHost>
              <ComposerTwinAssistHost>
                <ChatInput.Input {...inputProps} disabled={disabled} />
              </ComposerTwinAssistHost>
            </ComposerScheduleHost>
            <ChatInput.FormattingPanel />
          </View>
        </View>
      </View>
    </ChatInput.Root>
  );
}

const ConversationInput = memo(ConversationInputComponent);
ConversationInput.displayName = 'ConversationInput';

export { ConversationInput };
