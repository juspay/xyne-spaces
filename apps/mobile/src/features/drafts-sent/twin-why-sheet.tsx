import { type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';

type TwinWhySheetProps = {
  isOpen: boolean;
  reasoning: string;
  onOpenChange: (open: boolean) => void;
};

export function TwinWhySheet({ isOpen, reasoning, onOpenChange }: TwinWhySheetProps): ReactElement {
  const insets = useSafeAreaInsets();
  const foreground = useCSSVariable('--color-foreground') as string;

  return (
    <AppBottomSheet isOpen={isOpen} onOpenChange={onOpenChange} mode='dynamic'>
      <BottomSheetScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
      >
        <View className='gap-2 pt-1'>
          <Text className='text-base font-semibold' style={{ color: foreground }}>
            Why this draft?
          </Text>
          <Text className='text-xs' style={{ color: foreground }}>
            Only you can see this. Twin never posts this reasoning.
          </Text>
          <Text className='text-[15px] leading-5' style={{ color: foreground }}>
            {reasoning}
          </Text>
        </View>
      </BottomSheetScrollView>
    </AppBottomSheet>
  );
}
