import { memo, useCallback, useEffect, useMemo, useRef, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { Check, X } from 'lucide-react-native';
import { Easing } from 'react-native-reanimated';
import { TicketPriority } from '@xyne/shared';
import { useCSSVariable } from 'uniwind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cn } from '@/src/utils/cn';

import { TICKET_PRIORITY_FILTER_OPTIONS } from '../../constants';
import { TicketsPriorityIcon } from './tickets-priority-icon';
import { HeaderIconButton } from '@/src/components/ui/header-icon-button';

const ANIMATION_DURATION_MS = 320;
const BACKDROP_OPACITY = 0.45;
/**
 * Sized from a snap point, never from measured content. With `enableDynamicSizing`
 * gorhom derives its only snap point from the height BottomSheetView reports, and
 * when that measurement loses the race against the first `snapToIndex(0)` the
 * sheet never engages (no onChange, nothing drawn). The list is fixed: four
 * priority rows under a header, so the height is computed instead.
 */
const PRIORITY_ROW_HEIGHT = 52;
/** Drag handle (24) + header row (48) + its bottom margin (4). */
const PRIORITY_SHEET_CHROME_HEIGHT = 76;

type TicketsPriorityFilterSheetProps = {
  isOpen: boolean;
  selectedPriorities: readonly TicketPriority[];
  onOpenChange: (open: boolean) => void;
  /**
   * Toggle one priority (add/remove), then parent closes the sheet.
   * Gmail Attachment-style: select → close → reopen to pick another.
   */
  onTogglePriority: (priority: TicketPriority) => void;
};

type PriorityRowProps = {
  priority: TicketPriority;
  label: string;
  isSelected: boolean;
  onToggle: (priority: TicketPriority) => void;
};

const PriorityRow = memo(function PriorityRow({
  priority,
  label,
  isSelected,
  onToggle,
}: PriorityRowProps) {
  const checkColor = useCSSVariable('--color-accent-foreground') as string;

  return (
    <Pressable
      accessibilityRole='checkbox'
      accessibilityState={{ checked: isSelected }}
      accessibilityLabel={label}
      onPress={() => onToggle(priority)}
      className='flex-row items-center gap-3.5 px-5 active:opacity-70'
      style={{ height: PRIORITY_ROW_HEIGHT }}
    >
      <View className='size-6 items-center justify-center'>
        <TicketsPriorityIcon priority={priority} size={16} />
      </View>
      <Text className='min-w-0 flex-1 text-[16px] font-normal text-foreground' numberOfLines={1}>
        {label}
      </Text>
      <View
        className={cn(
          'size-5.5 items-center justify-center rounded-md border-2',
          isSelected
            ? 'border-blue-700 bg-blue-700'
            : 'border-foreground/35 bg-transparent dark:border-foreground/45',
        )}
      >
        {isSelected ? <Check size={14} color={checkColor} strokeWidth={3} /> : null}
      </View>
    </Pressable>
  );
});

/**
 * Gmail Attachment-style priority filter drawer (@gorhom/bottom-sheet).
 * Multi-select: tap toggles one value and closes; reopen to add another.
 */
export const TicketsPriorityFilterSheet = memo(function TicketsPriorityFilterSheet({
  isOpen,
  selectedPriorities,
  onOpenChange,
  onTogglePriority,
}: TicketsPriorityFilterSheetProps) {
  const sheetRef = useRef<ComponentRef<typeof BottomSheet>>(null);
  const isOpeningRef = useRef(false);
  const hasReportedClosedRef = useRef(!isOpen);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const foreground = useCSSVariable('--color-foreground') as string;
  const sheetBg = useCSSVariable('--color-bottomsheet-bg') as string;
  const selectedSet = new Set(selectedPriorities);
  const sheetIndex = isOpen ? 0 : -1;

  const backgroundStyle = useMemo(
    () => [styles.sheetBackground, { backgroundColor: sheetBg }],
    [sheetBg],
  );

  const bottomPadding = Math.max(insets.bottom, 12) + 8;
  const snapPoints = useMemo(
    () => [
      Math.min(
        windowHeight - insets.top,
        PRIORITY_SHEET_CHROME_HEIGHT +
          TICKET_PRIORITY_FILTER_OPTIONS.length * PRIORITY_ROW_HEIGHT +
          bottomPadding,
      ),
    ],
    [windowHeight, insets.top, bottomPadding],
  );

  useEffect(() => {
    if (isOpen) {
      hasReportedClosedRef.current = false;
      isOpeningRef.current = true;
      sheetRef.current?.snapToIndex(0);
      return;
    }
    isOpeningRef.current = false;
    sheetRef.current?.close();
  }, [isOpen]);

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) {
        // Ignore transient -1 while a controlled open is in flight.
        if (isOpeningRef.current) return;
        if (hasReportedClosedRef.current) return;
        hasReportedClosedRef.current = true;
        onOpenChange(false);
        return;
      }
      isOpeningRef.current = false;
      hasReportedClosedRef.current = false;
      onOpenChange(true);
    },
    [onOpenChange],
  );

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={BACKDROP_OPACITY}
        pressBehavior='close'
      />
    ),
    [],
  );

  return (
    <View
      pointerEvents={isOpen ? 'auto' : 'none'}
      style={styles.overlay}
      className='absolute inset-0'
    >
      <BottomSheet
        ref={sheetRef}
        index={sheetIndex}
        snapPoints={snapPoints}
        enableDynamicSizing={false}
        enableOverDrag={false}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        keyboardBehavior='interactive'
        keyboardBlurBehavior='restore'
        enableBlurKeyboardOnGesture
        android_keyboardInputMode='adjustPan'
        activeOffsetY={[-20, 20]}
        backgroundStyle={backgroundStyle}
        handleIndicatorStyle={styles.handleIndicator}
        topInset={insets.top}
        onChange={handleSheetChange}
        animationConfigs={{
          duration: ANIMATION_DURATION_MS,
          easing: Easing.out(Easing.cubic),
        }}
      >
        <BottomSheetView>
          <View style={{ paddingBottom: bottomPadding }}>
            <View className='mb-1 h-12 flex-row items-center justify-between px-5'>
              <Text className='text-[18px] font-semibold text-foreground'>Priority</Text>
              <HeaderIconButton
                liquidGlass
                accessibilityLabel='Close priority filter'
                onPress={handleClose}
              >
                <X size={20} color={foreground} strokeWidth={2.25} />
              </HeaderIconButton>
            </View>

            {TICKET_PRIORITY_FILTER_OPTIONS.map(option => (
              <PriorityRow
                key={option.value}
                priority={option.value}
                label={option.label}
                isSelected={selectedSet.has(option.value)}
                onToggle={onTogglePriority}
              />
            ))}
          </View>
        </BottomSheetView>
      </BottomSheet>
    </View>
  );
});

const styles = StyleSheet.create({
  overlay: {
    zIndex: 10000,
    elevation: 10000,
  },
  sheetBackground: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handleIndicator: {
    backgroundColor: '#CCC',
    width: 36,
    height: 5,
    borderRadius: 999,
  },
});
