import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { X } from 'lucide-react-native';
import { useRawSafeAreaInsets } from '@/src/hooks/useRawSafeAreaInsets';
import { useCSSVariable } from 'uniwind';

import { HeaderIconButton } from '@/src/components/ui/header-icon-button';
import { useAuth } from '@/src/contexts/AuthContext';
import { haptics } from '@/src/utils/haptics';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

const MAX_NAME_LENGTH = 50;

/** Long enough for the modal's slide-up to finish before the keyboard joins it. */
const AUTOFOCUS_DELAY_MS = 350;

/**
 * Full-page workspace creation, presented as a bottom-up modal over the open
 * drawer. Dismissing leaves the drawer exactly as it was, since its open state
 * lives in a store outside this route's tree.
 */
export function CreateWorkspaceScreen({ onClose }: { onClose: () => void }): ReactElement {
  const { createWorkspace } = useAuth();
  const { accentBg, accentFg } = useBubbleAccent();
  const insets = useRawSafeAreaInsets();
  const screenBg = useCSSVariable('--color-tabs-screen') as string;
  const foreground = useCSSVariable('--color-foreground') as string;
  const fieldBg = useCSSVariable('--color-secondary') as string;
  const placeholderColor = useCSSVariable('--color-secondary-foreground') as string;
  const dangerColor = useCSSVariable('--color-status-danger') as string;

  const inputRef = useRef<TextInput>(null);
  const [name, setName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => inputRef.current?.focus(), AUTOFOCUS_DELAY_MS);
    return (): void => clearTimeout(timeout);
  }, []);

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !isCreating;

  const handleCreate = useCallback(async (): Promise<void> => {
    if (!canSubmit) {
      return;
    }

    setIsCreating(true);
    setCreateError(null);
    Keyboard.dismiss();
    try {
      // Deliberately nothing after this on success. Applying the new session
      // bumps `workspaceSessionKey`, which remounts the shell — that tears this
      // page down and brings the drawer back closed, so any continuation here
      // would be running against an unmounted tree. Refetching the workspace
      // list would be wasted too: the query is keyed by the old workspace id,
      // and the remounted shell fetches under the new one.
      await createWorkspace(trimmedName);
    } catch (caught: unknown) {
      setCreateError(caught instanceof Error ? caught.message : 'Failed to create workspace.');
      setIsCreating(false);
    }
  }, [canSubmit, createWorkspace, trimmedName]);

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    onClose();
  }, [onClose]);

  return (
    <View className='flex-1' style={{ backgroundColor: screenBg, paddingTop: insets.top + 8 }}>
      <View className='px-4 pb-2'>
        {/* Falls back to the blur treatment on anything without UIGlassEffect.
            `disablePressScale` keeps that fallback from compressing as the page
            slides away, matching the Liquid Glass path which never compresses. */}
        <HeaderIconButton
          liquidGlass
          disablePressScale
          accessibilityLabel='Close'
          onPress={handleClose}
        >
          <X size={22} color={foreground} strokeWidth={2} />
        </HeaderIconButton>
      </View>

      <View className='px-5 pt-4'>
        <Text className='pb-6 text-2xl font-bold text-foreground'>New workspace</Text>

        <View className='gap-2'>
          <Text className='text-[13px] font-semibold text-secondary-foreground'>
            Workspace name
          </Text>
          <TextInput
            ref={inputRef}
            value={name}
            onChangeText={value => {
              setName(value);
              if (createError) setCreateError(null);
            }}
            placeholder='Ex: Acme Design'
            placeholderTextColor={placeholderColor}
            maxLength={MAX_NAME_LENGTH}
            autoCapitalize='words'
            autoCorrect={false}
            editable={!isCreating}
            returnKeyType='done'
            onSubmitEditing={() => void handleCreate()}
            className='rounded-xl px-3 py-3 text-[15px] text-foreground'
            style={{
              backgroundColor: fieldBg,
              borderWidth: 1,
              borderColor: createError ? dangerColor : 'transparent',
            }}
          />
          {createError ? (
            <Text className='text-sm text-status-danger' accessibilityLiveRegion='polite'>
              {createError}
            </Text>
          ) : null}
        </View>

        <Pressable
          className='mt-5 h-11 items-center justify-center rounded-xl active:opacity-80'
          style={{ backgroundColor: accentBg, opacity: canSubmit ? 1 : 0.4 }}
          onPress={() => {
            void haptics.buttonTap();
            void handleCreate();
          }}
          disabled={!canSubmit}
          accessibilityRole='button'
          accessibilityLabel='Create workspace'
          accessibilityState={{ disabled: !canSubmit }}
        >
          {isCreating ? (
            <ActivityIndicator size='small' color={accentFg} />
          ) : (
            <Text className='text-[15px] font-semibold' style={{ color: accentFg }}>
              Create workspace
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
