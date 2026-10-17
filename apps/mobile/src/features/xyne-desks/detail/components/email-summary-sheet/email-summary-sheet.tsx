import { memo, useCallback, useEffect, useMemo, useRef, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { RefreshCw, Sparkles } from 'lucide-react-native';
import { Easing } from 'react-native-reanimated';
import { useCSSVariable } from 'uniwind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { EmailSummaryState } from '../../hooks/use-email-thread-summary';
import { EmailSummaryContent } from './email-summary-content';
import { EmailSummaryShimmer } from './email-summary-shimmer';

const SNAP_POINTS = ['62%', '95%'];
const ANIMATION_DURATION_MS = 320;

type EmailSummarySheetProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  state: EmailSummaryState;
  summary: string;
  keypoints: string[];
  errorMessage: string;
  onRegenerate: () => void;
};

/**
 * Gmail-style bottom drawer for AI email-thread summary.
 * Gorhom BottomSheet with the same snap/animation config as AppBottomSheet.
 * Native back is handled by the ticket detail screen (closes sheet first).
 */
export const EmailSummarySheet = memo(function EmailSummarySheet({
  isOpen,
  onOpenChange,
  state,
  summary,
  keypoints,
  errorMessage,
  onRegenerate,
}: EmailSummarySheetProps) {
  const sheetRef = useRef<ComponentRef<typeof BottomSheet>>(null);
  const isOpeningRef = useRef(false);
  const hasReportedClosedRef = useRef(!isOpen);
  const insets = useSafeAreaInsets();

  const foreground = useCSSVariable('--color-foreground') as string;
  const mutedForeground = useCSSVariable('--color-secondary-foreground') as string;
  const brand = useCSSVariable('--color-brand') as string;
  const sheetBg = useCSSVariable('--color-bottomsheet-bg') as string;

  const showRegenerate = state === 'done' || state === 'error';
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

  return (
    <View
      pointerEvents={isOpen ? 'auto' : 'none'}
      style={styles.overlay}
      className='absolute inset-0'
    >
      <BottomSheet
        ref={sheetRef}
        index={sheetIndex}
        snapPoints={SNAP_POINTS}
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
        <BottomSheetScrollView
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 4,
            paddingBottom: Math.max(insets.bottom, 16) + 12,
          }}
        >
          <View className='mb-4 flex-row items-center justify-between'>
            <View className='flex-row items-center gap-2.5'>
              <View
                className='size-7 items-center justify-center rounded-lg'
                style={{ backgroundColor: brand || '#fe6d36' }}
              >
                <Sparkles size={14} color='#ffffff' />
              </View>
              <Text selectable={false} className='text-[16px] font-semibold text-foreground'>
                AI Summary
              </Text>
            </View>

            {showRegenerate ? (
              <Pressable
                accessibilityRole='button'
                accessibilityLabel={state === 'error' ? 'Retry summary' : 'Regenerate summary'}
                hitSlop={8}
                onPress={onRegenerate}
                className='size-9 items-center justify-center rounded-full active:bg-foreground/5'
              >
                <RefreshCw size={16} color={mutedForeground || foreground} />
              </Pressable>
            ) : null}
          </View>

          {state === 'loading' || state === 'idle' ? <EmailSummaryShimmer /> : null}

          {state === 'done' ? (
            <View className='gap-4'>
              <EmailSummaryContent summary={summary} keypoints={keypoints} />
              <Text selectable={false} className='text-[11px] text-secondary-foreground/70'>
                AI-generated · may not be fully accurate
              </Text>
            </View>
          ) : null}

          {state === 'error' ? (
            <View className='gap-3'>
              <Text selectable={false} className='text-[15px] leading-5.5 text-status-danger'>
                {errorMessage || 'Failed to generate summary. Please try again.'}
              </Text>
              <Pressable
                accessibilityRole='button'
                accessibilityLabel='Retry summary'
                onPress={onRegenerate}
                className='self-start rounded-lg bg-foreground/5 px-3.5 py-2 active:bg-foreground/10'
              >
                <Text selectable={false} className='text-[14px] font-medium text-foreground'>
                  Retry
                </Text>
              </Pressable>
            </View>
          ) : null}
        </BottomSheetScrollView>
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
