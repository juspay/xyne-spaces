import { useCallback, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BottomSheetView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { haptics } from '@/src/utils/haptics';

import { getRemoveMemberCopy } from './channel-member-actions';
import type { RemoveMemberSheetProps } from './remove-member-sheet.types';

export function RemoveMemberSheet({
  isPresented,
  memberName,
  channelName,
  visibility,
  isRemoving,
  onDismiss,
  onConfirm,
}: RemoveMemberSheetProps): ReactElement {
  const insets = useSafeAreaInsets();
  const { title, description } = getRemoveMemberCopy({
    memberName,
    channelName,
    visibility,
  });

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) onDismiss();
    },
    [onDismiss],
  );

  const handleConfirm = useCallback(() => {
    if (isRemoving) return;
    void haptics.buttonTap();
    onConfirm();
  }, [isRemoving, onConfirm]);

  const handleCancel = useCallback(() => {
    if (isRemoving) return;
    void haptics.buttonTap();
    onDismiss();
  }, [isRemoving, onDismiss]);

  return (
    <AppBottomSheet isOpen={isPresented} onOpenChange={handleOpenChange} mode='dynamic'>
      {/* mode='dynamic' sizes off BottomSheetView's measurement — a plain View
          never reports a height, so the sheet never opens. */}
      <BottomSheetView style={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}>
        <View className='px-5 pt-2'>
          <Text className='mb-2 text-lg font-semibold tracking-tight text-foreground'>{title}</Text>
          <Text className='text-sm leading-5 text-foreground/70'>{description}</Text>

          <View className='mt-6 gap-2.5'>
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Remove'
              disabled={isRemoving}
              onPress={handleConfirm}
              className='h-12 items-center justify-center rounded-xl bg-status-danger active:opacity-90'
            >
              <Text className='text-[15px] font-semibold text-white'>
                {isRemoving ? 'Removing…' : 'Remove'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole='button'
              accessibilityLabel='Cancel'
              disabled={isRemoving}
              onPress={handleCancel}
              className='h-12 items-center justify-center rounded-xl active:bg-muted'
            >
              <Text className='text-[15px] font-medium text-foreground'>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </BottomSheetView>
    </AppBottomSheet>
  );
}
