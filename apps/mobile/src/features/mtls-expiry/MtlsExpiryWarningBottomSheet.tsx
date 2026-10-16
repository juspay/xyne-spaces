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

const TITLE = 'Certificate expiring soon';
const RE_ENROLL_GUIDE = 'To re-enroll: scan the enrollment QR from Xyne Spaces on your laptop.';

export type MtlsExpiryWarningBottomSheetProps = {
  open: boolean;
  daysLeft: number;
  notAfterIso: string;
  onDismiss: () => void;
};

function buildMessage(notAfterIso: string, daysLeft: number): string {
  const expiresOn = new Date(notAfterIso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const dayLabel = daysLeft === 1 ? '1 day' : `${daysLeft} days`;
  return `Your device certificate expires in ${dayLabel} (${expiresOn}).`;
}

/**
 * Same Gorhom bottom-sheet chrome as the Airborne / app-update prompt
 * (`UpdatePromptBottomSheet`), optional-only (Got it!).
 */
export function MtlsExpiryWarningBottomSheet({
  open,
  daysLeft,
  notAfterIso,
  onDismiss,
}: MtlsExpiryWarningBottomSheetProps): ReactElement {
  const sheetRef = useRef<BottomSheetModal>(null);
  const isPresentedRef = useRef(false);
  const insets = useSafeAreaInsets();
  const sheetBackground = useCSSVariable('--color-card') as string;
  const handleColor = useCSSVariable('--color-muted') as string;
  const message = buildMessage(notAfterIso, daysLeft);

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
    onDismiss();
  }, [onDismiss]);

  const closeSheet = useCallback(() => {
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
      maxDynamicContentSize={360}
      enablePanDownToClose
      onDismiss={handleDismiss}
      backdropComponent={renderBackdrop}
      containerStyle={styles.modalContainer}
      backgroundStyle={[styles.sheetBackground, { backgroundColor: sheetBackground }]}
      handleIndicatorStyle={[styles.handleIndicator, { backgroundColor: handleColor }]}
    >
      <BottomSheetView style={{ paddingBottom: Math.max(insets.bottom, 12) + 4 }}>
        <View className='px-6 pb-1 pt-0.5'>
          <Text className='text-xl font-semibold tracking-tight text-foreground'>{TITLE}</Text>

          <Text className='mt-2.5 text-[15px] leading-6 text-secondary-foreground'>{message}</Text>

          <Text className='mb-7 mt-3 text-[15px] leading-6 text-foreground'>
            How to re-enroll{'\n'}
            {RE_ENROLL_GUIDE}
          </Text>

          <Pressable
            onPress={closeSheet}
            accessibilityRole='button'
            accessibilityLabel='Got it'
            className='w-full items-center justify-center py-3 active:opacity-60'
          >
            <Text className='text-[15px] font-medium text-secondary-foreground'>Got it!</Text>
          </Pressable>
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
