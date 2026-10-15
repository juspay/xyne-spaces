import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { useAuth } from '@/src/contexts/AuthContext';
import { applyFlagChanges, clearFlag } from '@/src/flags';
import { useStartupPhase } from '@/src/providers/StartupPhaseProvider';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

import { useBetaFlags } from './use-beta-flags';

/**
 * Takes back beta features the user is no longer allowed to have.
 *
 * Storage alone decides what renders — the snapshot is pinned at launch and
 * cannot ask CAC — so losing access in Superposition leaves the user on the
 * feature until something clears the key. This is that something.
 *
 * Deliberately not dismissable: the only way out is the action, which clears
 * the keys and remounts. Letting it be dismissed would mean a user who swipes
 * it away keeps a feature that was taken from them, which is the bug.
 */
export function RevokedBetaFlagsGate(): ReactElement | null {
  const { isSignedIn } = useAuth();
  const { hasFirstFramePainted, isProtectedStartupReady } = useStartupPhase();

  // Same gate as the update prompt: nothing fetches until the app is actually
  // up, so this never competes with first paint.
  const enabled = isSignedIn && hasFirstFramePainted && isProtectedStartupReady;
  const { revoked } = useBetaFlags(enabled);

  const sheetRef = useRef<BottomSheetModal>(null);
  const isPresentedRef = useRef(false);
  const [handled, setHandled] = useState(false);

  const insets = useSafeAreaInsets();
  const { accentBg, accentFg } = useBubbleAccent();
  const sheetBackground = useCSSVariable('--color-card') as string;

  const shouldShow = !handled && revoked.length > 0;

  useEffect(() => {
    if (shouldShow && !isPresentedRef.current) {
      isPresentedRef.current = true;
      sheetRef.current?.present();
      return;
    }
    // Dismissing before Gorhom has presented leaves the modal stuck in a
    // dismissing state and the next present is ignored.
    if (!shouldShow && isPresentedRef.current) {
      isPresentedRef.current = false;
      sheetRef.current?.dismiss();
    }
  }, [shouldShow]);

  /**
   * Android's back button dismisses a bottom sheet by default, which is a
   * second way out of a sheet that is supposed to have exactly one. Claimed
   * only while it is up, so back works normally everywhere else.
   */
  useEffect(() => {
    if (!shouldShow || Platform.OS !== 'android') return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return (): void => {
      subscription.remove();
    };
  }, [shouldShow]);

  const handleConfirm = useCallback((): void => {
    for (const key of revoked) {
      clearFlag(key);
    }
    setHandled(true);
    // Re-pins the snapshot and remounts the protected tree, so the user leaves
    // the feature in the same beat rather than on the next cold start.
    applyFlagChanges(0);
  }, [revoked]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.48}
        // Without this the backdrop closes on tap, which is what made the
        // sheet dismissable despite every other gesture being off.
        pressBehavior='none'
      />
    ),
    [],
  );

  if (!shouldShow) return null;

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      maxDynamicContentSize={320}
      enablePanDownToClose={false}
      enableDismissOnClose={false}
      enableContentPanningGesture={false}
      enableHandlePanningGesture={false}
      enableOverDrag={false}
      backdropComponent={renderBackdrop}
      containerStyle={styles.modalContainer}
      backgroundStyle={[styles.sheetBackground, { backgroundColor: sheetBackground }]}
      handleComponent={null}
    >
      <BottomSheetView style={{ paddingBottom: Math.max(insets.bottom, 12) + 4 }}>
        <View className='px-6 pb-1 pt-6'>
          <Text className='text-xl font-semibold tracking-tight text-foreground'>
            Beta access updated
          </Text>

          <Text className='mb-7 mt-2.5 text-[15px] leading-6 text-secondary-foreground'>
            Your beta features have changed. Continue to apply the update.
          </Text>

          <Pressable
            onPress={handleConfirm}
            accessibilityRole='button'
            accessibilityLabel='Continue'
            className='w-full items-center justify-center rounded-2xl py-3.5 active:opacity-90'
            style={{ backgroundColor: accentBg }}
          >
            <Text className='text-[15px] font-semibold' style={{ color: accentFg }}>
              Continue
            </Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  modalContainer: { zIndex: 3000 },
  sheetBackground: { borderTopLeftRadius: 28, borderTopRightRadius: 28 },
});
