// ---------------------------------------------------------------------------
// SaveTitleModal
// Modal shown after stopping a recording to let the user name it.
// ---------------------------------------------------------------------------

import { type ReactElement, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useCSSVariable } from 'uniwind';

import { generateRecordingTitle } from '@/src/utils/recordingUtils';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SaveTitleModalProps {
  isOpen: boolean;
  startTime: number | null;
  isSaving: boolean;
  onSave: (title: string) => void;
  onDismiss: () => void;
}

export function SaveTitleModal({
  isOpen,
  startTime,
  isSaving,
  onSave,
  onDismiss,
}: SaveTitleModalProps): ReactElement | null {
  const defaultTitle = generateRecordingTitle(startTime);
  const [title, setTitle] = useState(defaultTitle);
  const inputRef = useRef<TextInput>(null);

  const borderColor = useCSSVariable('--color-border') as string;
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const mutedColor = useCSSVariable('--color-secondary-foreground') as string;
  const cardBg = useCSSVariable('--color-card') as string;

  // Reset title and focus input whenever modal opens
  useEffect(() => {
    if (isOpen) {
      const fresh = generateRecordingTitle(startTime);
      setTitle(fresh);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, startTime]);

  if (!isOpen) return null;

  const handleSave = (): void => {
    const final = title.trim() || defaultTitle;
    Keyboard.dismiss();
    onSave(final);
  };

  const handleUseDefault = (): void => {
    Keyboard.dismiss();
    onSave(defaultTitle);
  };

  return (
    <Modal
      visible={isOpen}
      transparent
      animationType='fade'
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <Pressable
        className='flex-1 bg-black/50 items-center justify-center px-6'
        onPress={onDismiss}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          className='w-full'
        >
          {/* Card — stops press events from bubbling to backdrop */}
          <Pressable
            className='rounded-2xl p-6 gap-4 w-full'
            style={{ backgroundColor: cardBg }}
            onPress={() => {}}
          >
            <Text className='text-lg font-bold text-foreground' style={{ color: foregroundColor }}>
              Name your recording
            </Text>

            <TextInput
              ref={inputRef}
              value={title}
              onChangeText={setTitle}
              placeholder={defaultTitle}
              placeholderTextColor={mutedColor}
              returnKeyType='done'
              onSubmitEditing={handleSave}
              editable={!isSaving}
              className='text-sm text-foreground rounded-xl px-4 py-3'
              style={{
                borderWidth: 1,
                borderColor,
                color: foregroundColor,
                backgroundColor: cardBg,
              }}
              selectTextOnFocus
            />

            <View className='flex-row gap-3'>
              <Pressable
                onPress={handleUseDefault}
                disabled={isSaving}
                className='flex-1 py-3 rounded-xl bg-muted items-center active:opacity-70'
              >
                <Text
                  className='text-sm font-medium text-secondary-foreground'
                  style={{ color: mutedColor }}
                >
                  Use default
                </Text>
              </Pressable>

              <Pressable
                onPress={handleSave}
                disabled={isSaving}
                className='flex-1 py-3 rounded-xl bg-indigo-500 items-center active:opacity-70'
              >
                <Text className='text-sm font-semibold text-white'>
                  {isSaving ? 'Saving…' : 'Save'}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}
