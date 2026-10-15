import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { View, Keyboard } from 'react-native';
import type { ChannelSection } from '@xyne/shared';
import { AppBottomSheet, type AppBottomSheetRef } from '@/src/components/ui/app-bottom-sheet';
import { useChannelSections } from '@/src/hooks/useChannelSections';
import { useUserChannelStatuses } from '@/src/hooks/useChannels';
import { haptics } from '@/src/utils/haptics';
import { showMessageToast } from '@/src/utils/toast';
import { useSectionableChannels } from './section-channel-picker';
import { SectionChannelPickerStep } from './section-channel-picker-step';
import { SectionSheetHeader } from './section-sheet-header';

type ManageSectionChannelsSheetProps = {
  section: ChannelSection | null;
  isOpen: boolean;
  onClose: () => void;
};

export function ManageSectionChannelsSheet({
  section,
  isOpen,
  onClose,
}: ManageSectionChannelsSheetProps): ReactElement | null {
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
    <ManageSectionSheetContent
      section={section}
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      onDismiss={handleDismiss}
    />
  );
}

function ManageSectionSheetContent({
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
  const { addChannelsToSection, removeChannelsFromSection } = useChannelSections();
  const userChannelStatuses = useUserChannelStatuses();
  const sheetRef = useRef<AppBottomSheetRef>(null);

  const currentChannelIds = useMemo(
    () => userChannelStatuses.filter(s => s.sectionId === section.id).map(s => s.channelId),
    [userChannelStatuses, section.id],
  );

  const [selected, setSelected] = useState<Set<string>>(() => new Set(currentChannelIds));
  const currentChannelIdsRef = useRef(currentChannelIds);
  currentChannelIdsRef.current = currentChannelIds;

  /**
   * The membership is seeded when the sheet opens and then owned by the user.
   * Re-seeding on every query emission would drop ticks made mid-edit whenever
   * a sync landed.
   */
  useEffect(() => {
    if (!isOpen) return;
    setSelected(new Set(currentChannelIdsRef.current));
  }, [isOpen]);

  const sectionableChannels = useSectionableChannels();

  const { toAdd, toRemove } = useMemo(() => {
    const originalSet = new Set(currentChannelIds);
    return {
      toAdd: [...selected].filter(id => !originalSet.has(id)),
      toRemove: [...originalSet].filter(id => !selected.has(id)),
    };
  }, [currentChannelIds, selected]);

  const hasChanges = toAdd.length > 0 || toRemove.length > 0;

  const toggleChannel = useCallback((id: string) => {
    void haptics.selection();
    setSelected(prev => {
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
    if (toAdd.length > 0) {
      addChannelsToSection(toAdd, section.id);
    }
    if (toRemove.length > 0) {
      removeChannelsFromSection(toRemove);
    }

    void haptics.success();
    // No tone: the haptic above already reports the outcome.
    pendingToastRef.current = `${section.name} channels updated successfully`;
    dismissSheet();
  }, [
    addChannelsToSection,
    dismissSheet,
    removeChannelsFromSection,
    section.id,
    section.name,
    toAdd,
    toRemove,
  ]);

  const subtitle = section.emoji ? `${section.emoji} ${section.name}` : section.name;

  return (
    <AppBottomSheet
      ref={sheetRef}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      onDismiss={handleSheetDismiss}
      backdropOpacity={0.4}
      mode='fullscreen'
      android_keyboardInputMode='adjustResize'
    >
      <View className='flex-1'>
        <SectionSheetHeader
          withDivider
          leading='close'
          onLeadingPress={dismissSheet}
          title='Manage channels'
          subtitle={subtitle}
          actionLabel='Save'
          onActionPress={handleSave}
          isActionDisabled={!hasChanges}
        />
        <SectionChannelPickerStep
          channels={sectionableChannels}
          selectedIds={selected}
          onToggle={toggleChannel}
        />
      </View>
    </AppBottomSheet>
  );
}
