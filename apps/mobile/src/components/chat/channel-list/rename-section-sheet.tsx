import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { BackHandler, Keyboard, Platform, Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import type { ChannelSection } from '@xyne/shared';
import { AppBottomSheet, type AppBottomSheetRef } from '@/src/components/ui/app-bottom-sheet';
import { useChannelSections } from '@/src/hooks/useChannelSections';
import { haptics } from '@/src/utils/haptics';
import { showMessageToast } from '@/src/utils/toast';
import { SectionSheetHeader } from './section-sheet-header';
import {
  SECTION_NAME_MAX_LENGTH,
  sectionNameError,
  SectionSheetTextField,
} from './section-sheet-parts';

/**
 * Rename used to be a hand-rolled card riding `KeyboardStickyView`, because a
 * short gorhom sheet does not lift above the keyboard in this app's portal
 * setup. Fullscreen sidesteps that entirely — the field sits near the top, far
 * above any keyboard — so this is an ordinary sheet again, wearing the same
 * chrome as create and manage.
 */

type RenameSectionSheetProps = {
  section: ChannelSection | null;
  isOpen: boolean;
  onClose: () => void;
};

export function RenameSectionSheet({
  section,
  isOpen,
  onClose,
}: RenameSectionSheetProps): ReactElement | null {
  const [shouldRender, setShouldRender] = useState(isOpen);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
    }
  }, [isOpen]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        onClose();
      }
    },
    [onClose],
  );

  const handleDismiss = useCallback(() => {
    setShouldRender(false);
  }, []);

  if (!shouldRender || !section) {
    return null;
  }

  return (
    <RenameSectionSheetContent
      section={section}
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      onDismiss={handleDismiss}
    />
  );
}

function RenameSectionSheetContent({
  section,
  isOpen,
  onOpenChange,
  onDismiss,
}: {
  section: ChannelSection;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss: () => void;
}): ReactElement {
  const { renameSection, existingNames } = useChannelSections();
  const sheetRef = useRef<AppBottomSheetRef>(null);

  const [name, setName] = useState(section.name);
  const [touched, setTouched] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const [isSheetReady, setIsSheetReady] = useState(false);

  useEffect(() => {
    if (isOpen) return;
    setName(section.name);
    setTouched(false);
    setHasSaved(false);
    setIsSheetReady(false);
  }, [isOpen, section.name]);

  const handleSheetChange = useCallback((index: number) => {
    setIsSheetReady(index >= 0);
  }, []);

  const trimmedName = name.trim();
  const nameError = useMemo(
    () => sectionNameError(name, existingNames, section.name),
    [existingNames, name, section.name],
  );

  const dismissSheet = useCallback(() => {
    Keyboard.dismiss();
    sheetRef.current?.dismiss();
  }, []);

  /**
   * The toast waits for the sheet to finish closing: its modal presenting on
   * top of a sheet still tearing itself down is the kind of overlap iOS takes
   * badly.
   */
  const pendingToastRef = useRef<string | null>(null);

  const handleSheetDismiss = useCallback(() => {
    const message = pendingToastRef.current;
    pendingToastRef.current = null;
    onDismiss();
    if (message) {
      setTimeout(() => showMessageToast(message), 0);
    }
  }, [onDismiss]);

  const handleSave = useCallback(() => {
    if (nameError) {
      setTouched(true);
      return;
    }
    setHasSaved(true);
    renameSection(section.id, trimmedName, section.emoji ?? undefined);
    void haptics.success();
    // No tone: the haptic above already reports the outcome.
    pendingToastRef.current = `${trimmedName} renamed successfully`;
    dismissSheet();
  }, [dismissSheet, nameError, renameSection, section.emoji, section.id, trimmedName]);

  // Own the hardware back button rather than leaving it to gorhom's default,
  // which can desync a sheet holding a focused field from its keyboard.
  useEffect(() => {
    if (Platform.OS !== 'android' || !isOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      dismissSheet();
      return true;
    });
    return (): void => subscription.remove();
  }, [dismissSheet, isOpen]);

  return (
    <AppBottomSheet
      ref={sheetRef}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onDismiss={handleSheetDismiss}
      onChange={handleSheetChange}
      backdropOpacity={0.4}
      mode='fullscreen'
      android_keyboardInputMode='adjustResize'
    >
      <BottomSheetScrollView style={{ flex: 1 }} keyboardShouldPersistTaps='handled'>
        <SectionSheetHeader
          leading='close'
          onLeadingPress={dismissSheet}
          title='Rename section'
          subtitle={section.emoji ? `${section.emoji} ${section.name}` : section.name}
          actionLabel='Save'
          onActionPress={handleSave}
          isActionDisabled={!!nameError && !hasSaved}
        />

        <View className='px-4 pb-6 pt-1'>
          <SectionSheetTextField
            shouldAutoFocus={isSheetReady}
            label='Section name'
            value={name}
            onChangeText={value => {
              setName(value);
              setTouched(true);
            }}
            placeholder='Section name'
            maxLength={SECTION_NAME_MAX_LENGTH}
            error={touched && !hasSaved ? nameError : null}
            prefix={
              section.emoji ? <Text className='mr-1.5 text-base'>{section.emoji}</Text> : null
            }
            onSubmitEditing={handleSave}
          />
        </View>
      </BottomSheetScrollView>
    </AppBottomSheet>
  );
}
