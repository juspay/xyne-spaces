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

import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

export type BetaAvailableBottomSheetProps = {
  title: string;
  message: string;
  /** e.g. "New DMs screen, Chat v3 and 1 more". Omitted when empty. */
  pendingSummary: string;
  /** User chose to open Settings → Beta. Called after the sheet has closed. */
  onOpenBeta: () => void;
  /** Fired once the sheet has fully closed, however it was closed. */
  onClosed: () => void;
};

/**
 * Optional nudge, so every normal way out works: swipe down, backdrop tap,
 * "Not now", and Android back (Gorhom's default). Presented on mount; the gate
 * unmounts it once `onClosed` fires.
 *
 * Sits below the update and revocation sheets (`zIndex` 2000 vs 3000) so it can
 * never cover one of those, even in a race the gate does not foresee.
 */
export function BetaAvailableBottomSheet({
  title,
  message,
  pendingSummary,
  onOpenBeta,
  onClosed,
}: BetaAvailableBottomSheetProps): ReactElement {
  const sheetRef = useRef<BottomSheetModal>(null);
  const openBetaOnCloseRef = useRef(false);
  const { accentBg, accentFg } = useBubbleAccent();
  const insets = useSafeAreaInsets();
  const sheetBackground = useCSSVariable('--color-card') as string;
  const handleColor = useCSSVariable('--color-muted') as string;

  useEffect(() => {
    sheetRef.current?.present();
  }, []);

  const handleDismiss = useCallback((): void => {
    const shouldOpenBeta = openBetaOnCloseRef.current;
    openBetaOnCloseRef.current = false;
    onClosed();
    // Navigate only after the modal is gone, otherwise it can stay portalled
    // above the Beta screen it just opened.
    if (shouldOpenBeta) {
      onOpenBeta();
    }
  }, [onClosed, onOpenBeta]);

  const handleTryPress = useCallback((): void => {
    openBetaOnCloseRef.current = true;
    sheetRef.current?.dismiss();
  }, []);

  const handleNotNowPress = useCallback((): void => {
    sheetRef.current?.dismiss();
  }, []);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.48}
        pressBehavior='close'
      />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      maxDynamicContentSize={380}
      enablePanDownToClose
      onDismiss={handleDismiss}
      backdropComponent={renderBackdrop}
      containerStyle={styles.modalContainer}
      backgroundStyle={[styles.sheetBackground, { backgroundColor: sheetBackground }]}
      handleIndicatorStyle={[styles.handleIndicator, { backgroundColor: handleColor }]}
    >
      <BottomSheetView style={{ paddingBottom: Math.max(insets.bottom, 12) + 4 }}>
        <View className='px-6 pb-1 pt-0.5'>
          <Text className='mb-2 text-sm font-medium text-secondary-foreground'>Beta</Text>

          <Text className='text-xl font-semibold tracking-tight text-foreground'>{title}</Text>

          <Text className='mt-2.5 text-[15px] leading-6 text-secondary-foreground'>{message}</Text>

          {pendingSummary ? (
            <Text className='mt-2 text-[15px] leading-6 text-foreground'>{pendingSummary}</Text>
          ) : null}

          <Pressable
            onPress={handleTryPress}
            accessibilityRole='button'
            accessibilityLabel='Try beta features'
            className='mt-7 w-full items-center justify-center rounded-2xl py-3.5 active:opacity-90'
            style={{ backgroundColor: accentBg }}
          >
            <Text className='text-[15px] font-semibold' style={{ color: accentFg }}>
              Try beta features
            </Text>
          </Pressable>

          <Pressable
            onPress={handleNotNowPress}
            accessibilityRole='button'
            accessibilityLabel='Not now'
            className='mt-1 w-full items-center justify-center py-3 active:opacity-60'
          >
            <Text className='text-[15px] font-medium text-secondary-foreground'>Not now</Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    zIndex: 2000,
    elevation: 2000,
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
