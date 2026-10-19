import { memo, useCallback, useEffect, useMemo, useRef, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { Archive } from 'lucide-react-native';
import { Easing } from 'react-native-reanimated';
import { useCSSVariable } from 'uniwind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ANIMATION_DURATION_MS = 320;

type ArchiveTicketSheetProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

/**
 * Minimal archive confirmation as a Gorhom bottom sheet.
 */
export const ArchiveTicketSheet = memo(function ArchiveTicketSheet({
  isOpen,
  onOpenChange,
  onConfirm,
}: ArchiveTicketSheetProps) {
  const sheetRef = useRef<ComponentRef<typeof BottomSheet>>(null);
  const isOpeningRef = useRef(false);
  const hasReportedClosedRef = useRef(!isOpen);
  const insets = useSafeAreaInsets();

  const danger = useCSSVariable('--color-status-danger') as string;
  const sheetBg = useCSSVariable('--color-bottomsheet-bg') as string;

  const sheetIndex = isOpen ? 0 : -1;

  const backgroundStyle = useMemo(
    () => [styles.sheetBackground, { backgroundColor: sheetBg }],
    [sheetBg],
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

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.5}
        pressBehavior='close'
      />
    ),
    [],
  );

  const close = () => onOpenChange(false);

  const handleConfirm = () => {
    close();
    onConfirm();
  };

  return (
    <View
      pointerEvents={isOpen ? 'auto' : 'none'}
      className='absolute inset-0 z-10000'
      style={styles.overlayElevation}
    >
      <BottomSheet
        ref={sheetRef}
        index={sheetIndex}
        enableDynamicSizing
        enableOverDrag={false}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        backgroundStyle={backgroundStyle}
        handleIndicatorStyle={styles.handleIndicator}
        topInset={insets.top}
        onChange={handleSheetChange}
        animationConfigs={{
          duration: ANIMATION_DURATION_MS,
          easing: Easing.out(Easing.cubic),
        }}
      >
        <BottomSheetView
          className='px-5 pt-2'
          style={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
        >
          <View className='mb-4 size-11 items-center justify-center rounded-full bg-status-danger/10'>
            <Archive size={20} color={danger || '#DC2626'} strokeWidth={2} />
          </View>

          <Text className='mb-2 text-lg font-semibold tracking-tight text-foreground'>
            Archive this ticket?
          </Text>

          <Text className='text-sm leading-5 text-foreground/70'>
            This cannot be undone. The ticket stays saved, but it will not show in active views.
          </Text>

          <View className='mt-6 gap-2.5'>
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Archive Ticket'
              onPress={handleConfirm}
              className='h-12 items-center justify-center rounded-xl bg-status-danger active:opacity-90'
            >
              <Text className='text-[15px] font-semibold text-white'>Archive Ticket</Text>
            </Pressable>

            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Cancel'
              onPress={close}
              className='h-12 items-center justify-center rounded-xl bg-secondary active:opacity-80'
            >
              <Text className='text-[15px] font-medium text-foreground'>Cancel</Text>
            </Pressable>
          </View>
        </BottomSheetView>
      </BottomSheet>
    </View>
  );
});

/** Gorhom style props cannot use className — keep these as StyleSheet. */
const styles = StyleSheet.create({
  overlayElevation: {
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
