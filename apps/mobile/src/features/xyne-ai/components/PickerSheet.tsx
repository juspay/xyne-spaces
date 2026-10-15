import type { ReactElement, ReactNode } from 'react';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';

export const PickerSheet = ({
  isOpen,
  onOpenChange,
  children,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}): ReactElement => {
  const insets = useSafeAreaInsets();
  return (
    <AppBottomSheet isOpen={isOpen} onOpenChange={onOpenChange} mode='dynamic'>
      <BottomSheetScrollView
        contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: insets.bottom + 16 }}
      >
        {children}
      </BottomSheetScrollView>
    </AppBottomSheet>
  );
};
