import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { BackHandler, Keyboard, Platform, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { AppBottomSheet, type AppBottomSheetRef } from '@/src/components/ui/app-bottom-sheet';
import { useChannelSections } from '@/src/hooks/useChannelSections';
import { haptics } from '@/src/utils/haptics';
import { showMessageToast } from '@/src/utils/toast';
import { useSectionableChannels } from './section-channel-picker';
import { SectionChannelPickerStep } from './section-channel-picker-step';
import { SectionSheetHeader } from './section-sheet-header';
import {
  SECTION_NAME_MAX_LENGTH,
  sectionNameError,
  SectionSheetTextField,
} from './section-sheet-parts';

/**
 * Naming the section is the whole of creating it, the way Slack's desktop
 * "Create new section" is: tapping Create writes the section then and there.
 * The channel picker that follows is an optional continuation working on a
 * section that already exists, so leaving it — Skip, back, or a swipe — costs
 * nothing. Picking channels also gets the full sheet, which is what the old
 * single crowded sheet could never give it.
 *
 * Both steps are fullscreen. A content-sized sheet would suit a lone text
 * field better, but a short sheet is exactly what does not lift above the
 * keyboard in this app's portal setup, and holding one height across the two
 * steps also spares the flow a resize mid-transition.
 */
type CreateSectionStep = 'name' | 'channels';

type CreateSectionSheetProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function CreateSectionSheet({
  isOpen,
  onClose,
}: CreateSectionSheetProps): ReactElement | null {
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

  if (!shouldRender) {
    return null;
  }

  return (
    <CreateSectionSheetContent
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      onDismiss={handleDismiss}
    />
  );
}

function CreateSectionSheetContent({
  isOpen,
  onOpenChange,
  onDismiss,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss: () => void;
}): ReactElement {
  const { createSection, existingNames, addChannelsToSection } = useChannelSections();
  const sheetRef = useRef<AppBottomSheetRef>(null);

  const [step, setStep] = useState<CreateSectionStep>('name');
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  /** Set once Create has written the section; the picker step targets it. */
  const [createdSectionId, setCreatedSectionId] = useState<string | null>(null);
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<string>>(new Set());
  const [isSheetReady, setIsSheetReady] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setStep('name');
      setName('');
      setTouched(false);
      setSelectedChannelIds(new Set());
      setIsSheetReady(false);
      setCreatedSectionId(null);
    }
  }, [isOpen]);

  const handleSheetChange = useCallback((index: number) => {
    setIsSheetReady(index >= 0);
  }, []);

  const trimmedName = name.trim();
  const nameError = useMemo(() => sectionNameError(name, existingNames), [existingNames, name]);
  const sectionableChannels = useSectionableChannels();

  const toggleChannel = useCallback((id: string) => {
    void haptics.selection();
    setSelectedChannelIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const dismissSheet = useCallback(() => {
    Keyboard.dismiss();
    sheetRef.current?.dismiss();
  }, []);

  /**
   * The toast waits for the sheet to finish closing: its modal presenting
   * on top of a sheet still tearing itself down is the kind of overlap iOS
   * takes badly.
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

  /**
   * Creates the section and hands off to the picker. The toast is parked
   * rather than fired: the sheet stays open on the picker, and a toast modal
   * over a live sheet is the overlap iOS takes badly.
   */
  const handleCreate = useCallback(() => {
    if (nameError || createdSectionId) {
      setTouched(true);
      return;
    }
    const sectionId = createSection(trimmedName);
    setCreatedSectionId(sectionId);
    void haptics.success();
    // No tone: the haptic above already reports the outcome.
    pendingToastRef.current = `${trimmedName} created successfully`;
    // The list step wants the full sheet; leaving the keyboard up would undo
    // exactly the room this split was made to win back.
    Keyboard.dismiss();
    setStep('channels');
  }, [createSection, createdSectionId, nameError, trimmedName]);

  /** Commits the ticked channels to the section Create already made. */
  const handleDone = useCallback(() => {
    if (createdSectionId && selectedChannelIds.size > 0) {
      addChannelsToSection([...selectedChannelIds], createdSectionId);
    }
    dismissSheet();
  }, [addChannelsToSection, createdSectionId, dismissSheet, selectedChannelIds]);

  // Back never rewinds to the name step: by then the section exists, and
  // re-opening its name field would be a rename wearing a create's clothes.
  // From the picker it means Skip, which is exactly the default dismissal.
  useEffect(() => {
    if (Platform.OS !== 'android' || !isOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      dismissSheet();
      return true;
    });
    return (): void => subscription.remove();
  }, [dismissSheet, isOpen]);

  const isChannelsStep = step === 'channels';
  const hasSelection = selectedChannelIds.size > 0;

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
      {isChannelsStep ? (
        <View className='flex-1'>
          {/* Skip stays live whatever is ticked: it means "leave the section
              as Create made it", and dropping a few ticks on the way out is
              the point of it rather than a reason to bar the exit. */}
          <SectionSheetHeader
            withDivider
            leading='skip'
            onLeadingPress={dismissSheet}
            title='Add channels'
            subtitle={trimmedName}
            actionLabel='Done'
            onActionPress={handleDone}
            isActionDisabled={!hasSelection}
          />
          <SectionChannelPickerStep
            channels={sectionableChannels}
            selectedIds={selectedChannelIds}
            onToggle={toggleChannel}
          />
        </View>
      ) : (
        <BottomSheetScrollView style={{ flex: 1 }} keyboardShouldPersistTaps='handled'>
          <SectionSheetHeader
            leading='close'
            onLeadingPress={dismissSheet}
            title='New section'
            actionLabel='Create'
            onActionPress={handleCreate}
            isActionDisabled={!!nameError}
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
              placeholder='Ex: Project Beta'
              maxLength={SECTION_NAME_MAX_LENGTH}
              error={touched ? nameError : null}
              helperText='Sections are only visible to you.'
              onSubmitEditing={handleCreate}
            />
          </View>
        </BottomSheetScrollView>
      )}
    </AppBottomSheet>
  );
}
