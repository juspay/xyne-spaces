import { useEffect, type ReactElement } from 'react';
import { BackHandler, Pressable, Text, View } from 'react-native';
import { BottomSheetView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { useMountWhileOpen } from '@/src/features/global-search/hooks/use-mount-while-open';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { haptics } from '@/src/utils/haptics';

type Props = {
  isOpen: boolean;
  channelName: string;
  onClose: () => void;
  onConfirm: () => void;
};

export function GroupCallConfirmationSheet({
  isOpen,
  channelName,
  onClose,
  onConfirm,
}: Props): ReactElement | null {
  const { shouldRender, sheetProps } = useMountWhileOpen(isOpen, onClose);
  const insets = useSafeAreaInsets();
  const { accentBg, accentFg } = useBubbleAccent();
  useEffect(() => {
    if (!isOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return (): void => subscription.remove();
  }, [isOpen, onClose]);
  if (!shouldRender) return null;
  return (
    <AppBottomSheet {...sheetProps} mode='dynamic'>
      <BottomSheetView
        style={{
          paddingHorizontal: 24,
          paddingTop: 12,
          paddingBottom: Math.max(insets.bottom, 16) + 8,
        }}
      >
        <Text
          accessibilityRole='header'
          className='text-lg font-semibold text-bottomsheet-text-header'
        >
          Start a call?
        </Text>
        <Text className='mt-2 text-sm leading-5 text-bottomsheet-text-muted'>
          All members of {channelName || 'this channel'} can join.
        </Text>
        <View className='mt-5 flex-row gap-3'>
          <Pressable
            accessibilityRole='button'
            onPress={onClose}
            className='min-h-12 flex-1 items-center justify-center rounded-xl bg-foreground/5 px-4 py-3 active:opacity-80'
          >
            <Text className='text-base font-medium text-bottomsheet-text-muted'>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole='button'
            onPress={() => {
              void haptics.buttonTap();
              onConfirm();
            }}
            className='min-h-12 flex-1 items-center justify-center rounded-xl px-4 py-3 active:opacity-80'
            style={{ backgroundColor: accentBg }}
          >
            <Text className='text-base font-semibold' style={{ color: accentFg }}>
              Start call
            </Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </AppBottomSheet>
  );
}
