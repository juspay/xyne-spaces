import { format } from 'date-fns';
import { Clock } from 'lucide-react-native';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Alert, Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { ConversationInput } from '@/src/components/input-composer';
import type {
  ChatInputEditingMessage,
  ChatInputSendHandler,
} from '@/src/components/input-composer/input-composer.types';
import { getChatKeyboardStickyOffset } from '@/src/features/chat/v3/composer/chatKeyboardConfig';
import { useZero } from '@/src/hooks/useZero';
import { buildComposerContentForSend } from '@/src/utils/prepareComposerContentForSend';
import { showMessageToast } from '@/src/utils/toast';
import { haptics } from '@/src/utils/haptics';
import { mutators } from '@/src/zero/mutators';

import type { DelayedMessageRow } from './drafts-sent-utils';

type EditScheduledMessageComposerProps = {
  isOpen: boolean;
  row: DelayedMessageRow | null;
  onOpenChange: (open: boolean) => void;
};

/**
 * Edit a scheduled message with the same ConversationInput dock used in chat.
 */
export function EditScheduledMessageComposer({
  isOpen,
  row,
  onOpenChange,
}: EditScheduledMessageComposerProps): ReactElement | null {
  const zero = useZero();
  const insets = useSafeAreaInsets();
  const stickyOffset = getChatKeyboardStickyOffset(insets.bottom);
  const foreground = useCSSVariable('--color-foreground') as string;
  const mutedForeground = useCSSVariable('--color-muted-foreground') as string;
  const border = useCSSVariable('--color-border') as string;
  const surface = useCSSVariable('--color-conversation-input-surface') as string;
  const [activeRow, setActiveRow] = useState<DelayedMessageRow | null>(null);

  useEffect(() => {
    if (isOpen && row) {
      setActiveRow(row);
      return;
    }
    if (!isOpen) setActiveRow(null);
  }, [isOpen, row]);

  const close = useCallback((): void => {
    Keyboard.dismiss();
    onOpenChange(false);
  }, [onOpenChange]);

  const handleSend = useCallback<ChatInputSendHandler>(
    async (payload, restore) => {
      if (!activeRow) {
        restore();
        return;
      }

      const content = buildComposerContentForSend(payload.text, payload.html);
      if (!content) {
        Alert.alert('Nothing to save', 'Add a message before updating.');
        restore();
        return;
      }

      try {
        const result = await zero.mutate(
          mutators.delayedMessages.edit({
            id: activeRow.id,
            content,
            updatedAt: activeRow.updatedAt,
          }),
        ).client;
        if (result.type === 'error') throw new Error(result.error.message);
        void haptics.success();
        showMessageToast('Scheduled message updated', 'success');
        close();
      } catch (error: unknown) {
        restore();
        Alert.alert(
          'Could not update',
          error instanceof Error ? error.message : 'Please try again.',
        );
      }
    },
    [activeRow, close, zero],
  );

  if (!isOpen || !activeRow) return null;

  const scheduledLabel = format(activeRow.scheduledFor, 'MMM d, yyyy h:mm a');
  const editingMessage: ChatInputEditingMessage = {
    messageId: activeRow.id,
    conversationId: activeRow.conversationId ?? activeRow.channelId,
    channelId: activeRow.channelId,
    content: activeRow.content,
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents='box-none'>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel='Dismiss edit'
        style={StyleSheet.absoluteFill}
        className='bg-black/40'
        onPress={close}
      />

      <KeyboardStickyView offset={stickyOffset} style={styles.dock} pointerEvents='box-none'>
        <View style={{ backgroundColor: surface }}>
          <View
            className='mx-3 mt-2 flex-row items-center gap-2 rounded-t-xl bg-conversation-input-pill-bg px-3 py-2'
            style={{
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: border.length === 7 ? `${border}59` : border,
            }}
          >
            <Clock size={14} color={mutedForeground} />
            <Text className='flex-1 text-[13px]' style={{ color: foreground }} numberOfLines={1}>
              Scheduled for{' '}
              <Text className='font-semibold' style={{ color: foreground }}>
                {scheduledLabel}
              </Text>
            </Text>
          </View>

          <ConversationInput
            key={activeRow.id}
            conversationId={activeRow.channelId}
            {...(activeRow.conversationId ? { threadId: activeRow.conversationId } : {})}
            editingMessage={editingMessage}
            onCancelEdit={close}
            onSend={handleSend}
            placeholder='Edit scheduled message…'
            includeBottomSafeArea
          />
        </View>
      </KeyboardStickyView>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
  },
});
