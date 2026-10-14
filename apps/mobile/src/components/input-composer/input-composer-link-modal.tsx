import { memo, useCallback, useEffect, useRef, type ReactElement } from 'react';
import { Keyboard, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { useCSSVariable } from 'uniwind';

import { useRawSafeAreaInsets } from '@/src/hooks/useRawSafeAreaInsets';
import {
  useChatInputActions,
  useChatInputHandlers,
  useChatInputPanelState,
} from './input-composer-context';

const normalizeHref = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const KEYBOARD_BOTTOM_GAP = 32;

const LinkModalComponent = (): ReactElement => {
  const { inputRef } = useChatInputHandlers();
  const { isLinkModalOpen, linkModal } = useChatInputPanelState();
  const { closeLinkModal, setLinkModalText, setLinkModalUrl } = useChatInputActions();
  const textInputRef = useRef<TextInput | null>(null);
  const urlInputRef = useRef<TextInput | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboardHeight = useKeyboardState(state => (state.isVisible ? state.height : 0));
  const insets = useRawSafeAreaInsets();
  const activeColor = useCSSVariable('--color-action-primary') as string;
  const foreground = useCSSVariable('--color-foreground') as string;
  const muted = useCSSVariable('--color-muted') as string;
  const surface = useCSSVariable('--color-card') as string;
  const border = useCSSVariable('--color-border') as string;
  const actionPrimaryForeground = useCSSVariable('--color-accent-foreground') as string;

  const handleApply = useCallback((): void => {
    const href = normalizeHref(linkModal.url);
    const text = linkModal.text.trim() || href;
    if (!href || !text) return;

    const start = linkModal.selection?.start ?? 0;
    const end = linkModal.selection?.end ?? start;
    inputRef.current?.setLink(start, end, text, href);
    Keyboard.dismiss();
    closeLinkModal();
  }, [
    closeLinkModal,
    inputRef,
    linkModal.selection?.end,
    linkModal.selection?.start,
    linkModal.text,
    linkModal.url,
  ]);

  const canApply =
    normalizeHref(linkModal.url).length > 0 &&
    (linkModal.text.trim().length > 0 || !!linkModal.selection);
  const bottomInset = Math.max(insets.bottom, 0);
  const modalBottomPadding =
    keyboardHeight > 0 ? keyboardHeight + bottomInset + KEYBOARD_BOTTOM_GAP : bottomInset + 24;

  const focusInitialInput = useCallback((): void => {
    if (focusTimerRef.current) {
      clearTimeout(focusTimerRef.current);
    }

    focusTimerRef.current = setTimeout(() => {
      const hasSelectedText = (linkModal.selection?.text ?? '').trim().length > 0;
      if (hasSelectedText) {
        urlInputRef.current?.focus();
        return;
      }

      textInputRef.current?.focus();
    }, 100);
  }, [linkModal.selection?.text]);

  useEffect(() => {
    return (): void => {
      if (focusTimerRef.current) {
        clearTimeout(focusTimerRef.current);
      }
    };
  }, []);

  return (
    <Modal
      visible={isLinkModalOpen}
      transparent
      animationType='fade'
      onRequestClose={closeLinkModal}
      onShow={focusInitialInput}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <ScrollView
        className='flex-1 bg-black/40'
        keyboardShouldPersistTaps='handled'
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: keyboardHeight > 0 ? 'flex-end' : 'center',
          paddingBottom: modalBottomPadding,
          paddingHorizontal: 20,
          paddingTop: Math.max(insets.top, 24),
        }}
      >
        <View
          className='gap-4 rounded-xl p-4'
          style={{ backgroundColor: surface, borderColor: border, borderWidth: 1 }}
        >
          <View className='gap-1'>
            <Text style={{ color: foreground, fontSize: 16, fontWeight: '600' }}>Add link</Text>
          </View>

          <View className='gap-2'>
            <Text style={{ color: foreground, fontSize: 13, fontWeight: '500' }}>Text</Text>
            <TextInput
              ref={textInputRef}
              value={linkModal.text}
              onChangeText={setLinkModalText}
              placeholder='Text to show'
              placeholderTextColor={muted}
              autoCapitalize='sentences'
              className='rounded-lg px-3 py-2'
              style={{ borderColor: border, borderWidth: 1, color: foreground }}
            />
          </View>

          <View className='gap-2'>
            <Text style={{ color: foreground, fontSize: 13, fontWeight: '500' }}>URL</Text>
            <TextInput
              ref={urlInputRef}
              value={linkModal.url}
              onChangeText={setLinkModalUrl}
              placeholder='https://example.com'
              placeholderTextColor={muted}
              autoCapitalize='none'
              autoCorrect={false}
              keyboardType='url'
              className='rounded-lg px-3 py-2'
              style={{ borderColor: border, borderWidth: 1, color: foreground }}
            />
          </View>

          <View className='flex-row justify-end gap-3'>
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Cancel link'
              onPress={closeLinkModal}
              className='rounded-lg px-4 py-2'
            >
              <Text style={{ color: muted, fontSize: 15, fontWeight: '600' }}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Apply link'
              disabled={!canApply}
              onPress={handleApply}
              className='rounded-lg px-4 py-2'
              style={{ backgroundColor: activeColor, opacity: canApply ? 1 : 0.45 }}
            >
              <Text style={{ color: actionPrimaryForeground, fontSize: 15, fontWeight: '600' }}>
                Apply
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </Modal>
  );
};

const LinkModal = memo(LinkModalComponent);
LinkModal.displayName = 'ChatInput.LinkModal';

export { LinkModal };
