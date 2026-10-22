import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { type ReactElement, useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { cacService } from '@/src/services/cac';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

export type UpdatePromptBottomSheetProps = {
  open: boolean;
  mode: 'optional' | 'force';
  title: string;
  message: string;
  /** Used on Android only. iOS opens TestFlight in code. */
  storeUrl?: string;
  onDismiss?: () => void;
};

export function UpdatePromptBottomSheet({
  open,
  mode,
  title,
  message,
  storeUrl,
  onDismiss,
}: UpdatePromptBottomSheetProps): ReactElement {
  const sheetRef = useRef<BottomSheetModal>(null);
  const isPresentedRef = useRef(false);
  const { accentBg, accentFg } = useBubbleAccent();
  const insets = useSafeAreaInsets();
  const sheetBackground = useCSSVariable('--color-card') as string;
  const handleColor = useCSSVariable('--color-muted') as string;
  const isForce = mode === 'force';

  useEffect(() => {
    if (open && !isPresentedRef.current) {
      isPresentedRef.current = true;
      sheetRef.current?.present();
      return;
    }

    // Calling dismiss before Gorhom has ever presented the modal leaves it in
    // a dismissing state. The next present call is then ignored by the portal.
    if (!open && isPresentedRef.current) {
      isPresentedRef.current = false;
      sheetRef.current?.dismiss();
    }
  }, [open]);

  const handleDismiss = useCallback(() => {
    isPresentedRef.current = false;
    if (!isForce) {
      onDismiss?.();
    }
  }, [isForce, onDismiss]);

  const handleUpdatePress = useCallback(() => {
    void cacService.openUpdateDestination(storeUrl);
  }, [storeUrl]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.48}
        pressBehavior={isForce ? 'none' : 'close'}
      />
    ),
    [isForce],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      maxDynamicContentSize={360}
      enablePanDownToClose={!isForce}
      onDismiss={handleDismiss}
      backdropComponent={renderBackdrop}
      containerStyle={styles.modalContainer}
      backgroundStyle={[styles.sheetBackground, { backgroundColor: sheetBackground }]}
      handleIndicatorStyle={[styles.handleIndicator, { backgroundColor: handleColor }]}
    >
      <BottomSheetView style={{ paddingBottom: Math.max(insets.bottom, 12) + 4 }}>
        <View className='px-6 pb-1 pt-0.5'>
          {isForce ? (
            <Text className='mb-2 text-sm font-medium text-status-danger'>Update required</Text>
          ) : null}

          <Text className='text-xl font-semibold tracking-tight text-foreground'>{title}</Text>

          <Text className='mb-7 mt-2.5 text-[15px] leading-6 text-secondary-foreground'>
            {message}
          </Text>

          <Pressable
            onPress={handleUpdatePress}
            accessibilityRole='button'
            accessibilityLabel='Update now'
            className='w-full items-center justify-center rounded-2xl py-3.5 active:opacity-90'
            style={{ backgroundColor: accentBg }}
          >
            <Text className='text-[15px] font-semibold' style={{ color: accentFg }}>
              Update now
            </Text>
          </Pressable>

          {!isForce && onDismiss ? (
            <Pressable
              onPress={onDismiss}
              accessibilityRole='button'
              accessibilityLabel='Not now'
              className='mt-1 w-full items-center justify-center py-3 active:opacity-60'
            >
              <Text className='text-[15px] font-medium text-secondary-foreground'>Not now</Text>
            </Pressable>
          ) : null}
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    zIndex: 3000,
    elevation: 3000,
  },
  sheetBackground: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handleIndicator: {
    width: 36,
    height: 4,
    borderRadius: 999,
    marginTop: 10,
    opacity: 0.55,
  },
});
