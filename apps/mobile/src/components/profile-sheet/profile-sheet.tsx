import { ProfileView } from './profile-view';
import { useCSSVariable } from 'uniwind';
import {
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { forwardRef, memo, useCallback, useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';

import { ProfileSheetBackdrop } from './profile-sheet-backdrop';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const ProfileSheet = memo(
  forwardRef<BottomSheetModal>(function ProfileSheet(_props, ref) {
    const { height } = useWindowDimensions();
    const maxDynamicContentSize = useMemo(() => height * 0.9, [height]);
    const sheetBg = useCSSVariable('--color-secondary') as string;
    const handleColor = useCSSVariable('--color-muted') as string;
    const insets = useSafeAreaInsets();
    const close = useCallback(() => {
      if (typeof ref === 'function') return;
      ref?.current?.dismiss();
    }, [ref]);

    const renderBackdrop = useCallback(
      (props: BottomSheetBackdropProps) => <ProfileSheetBackdrop {...props} />,
      [],
    );

    return (
      <BottomSheetModal
        ref={ref}
        enableDynamicSizing
        maxDynamicContentSize={maxDynamicContentSize}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        backgroundStyle={[styles.sheetBackground, { backgroundColor: sheetBg }]}
        handleIndicatorStyle={[styles.handleIndicator, { backgroundColor: handleColor }]}
        containerStyle={styles.modalContainer}
      >
        <BottomSheetScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingTop: 12 }}
          showsVerticalScrollIndicator={false}
        >
          <ProfileView onClose={close} />
        </BottomSheetScrollView>
      </BottomSheetModal>
    );
  }),
);

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
    height: 5,
    borderRadius: 999,
  },
  contentContainer: {
    paddingTop: 4,
  },
  loadingContainer: {
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
