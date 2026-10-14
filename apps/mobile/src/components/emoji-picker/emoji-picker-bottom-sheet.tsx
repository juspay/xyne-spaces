import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import { BackHandler, Platform, View, useWindowDimensions } from 'react-native';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { EmojiPickerPanel } from './emoji-picker-panel';
import { getEmojiPickerPanelHeight, getEmojiPickerSheetHeight } from './emoji-picker.constants';
import { createEmojiPickerTraceId, logEmojiPickerDiagnostic } from './emoji-picker-diagnostics';
import type { EmojiPickerSelection } from './emoji-picker.types';

/** Emoji picker presented as a bottom sheet. */

type EmojiPickerBottomSheetProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires after the native sheet has fully dismissed. */
  onDismiss?: () => void;
  onSelect: (selection: EmojiPickerSelection) => void;
  showCustomTab?: boolean;
  traceId?: string;
};

type EmojiPickerSheetContentProps = {
  onSelect: (selection: EmojiPickerSelection) => void;
  showCustomTab: boolean;
  isOpen: boolean;
  traceId: string;
};

const EmojiPickerSheetContent = ({
  onSelect,
  showCustomTab,
  isOpen,
  traceId,
}: EmojiPickerSheetContentProps): ReactElement => {
  const { height: windowHeight } = useWindowDimensions();
  const panelHeight = getEmojiPickerPanelHeight(windowHeight);

  // Keep BottomSheetFlatList as the sheet's only registered vertical
  // scrollable. The panel owns the content height; the host owns its snap.
  return (
    <View style={{ height: panelHeight }}>
      <EmojiPickerPanel
        onSelect={onSelect}
        height={panelHeight}
        showCustomTab={showCustomTab}
        isOpen={isOpen}
        traceId={traceId}
      />
    </View>
  );
};

const EmojiPickerBottomSheet = ({
  isOpen,
  onOpenChange,
  onDismiss,
  onSelect,
  showCustomTab = true,
  traceId: providedTraceId,
}: EmojiPickerBottomSheetProps): ReactElement => {
  const traceIdRef = useRef(providedTraceId ?? createEmojiPickerTraceId());
  const traceId = traceIdRef.current;
  const { height: windowHeight } = useWindowDimensions();
  const sheetHeight = getEmojiPickerSheetHeight(windowHeight);

  useEffect(() => {
    logEmojiPickerDiagnostic(traceId, 'picker_open_state_changed', {
      isOpen,
    });
  }, [isOpen, traceId]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (!isOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      logEmojiPickerDiagnostic(traceId, 'picker_hardware_back');
      onOpenChange(false);
      return true;
    });
    return (): void => subscription.remove();
  }, [isOpen, onOpenChange, traceId]);

  const dismissAndSelect = useCallback(
    (selection: EmojiPickerSelection): void => {
      logEmojiPickerDiagnostic(traceId, 'picker_selection', { selectionType: selection.type });
      onSelect(selection);
      onOpenChange(false);
    },
    [onSelect, onOpenChange, traceId],
  );

  const handleDismiss = useCallback((): void => {
    logEmojiPickerDiagnostic(traceId, 'picker_native_dismissed');
    onOpenChange(false);
    onDismiss?.();
  }, [onDismiss, onOpenChange, traceId]);

  const handleSheetOpenChange = useCallback(
    (open: boolean): void => {
      if (open) return;
      logEmojiPickerDiagnostic(traceId, 'picker_requested_close');
      onOpenChange(false);
    },
    [onOpenChange, traceId],
  );

  return (
    <AppBottomSheet
      isOpen={isOpen}
      onOpenChange={handleSheetOpenChange}
      mode='snap'
      snapPoints={[sheetHeight]}
      index={0}
      backdropOpacity={0.4}
      animationDuration={260}
      onDismiss={handleDismiss}
      onChange={index => logEmojiPickerDiagnostic(traceId, 'picker_sheet_index_changed', { index })}
    >
      <EmojiPickerSheetContent
        onSelect={dismissAndSelect}
        showCustomTab={showCustomTab}
        isOpen={isOpen}
        traceId={traceId}
      />
    </AppBottomSheet>
  );
};

EmojiPickerBottomSheet.displayName = 'EmojiPickerBottomSheet';

export { EmojiPickerBottomSheet };
