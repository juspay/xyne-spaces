import { type ReactElement } from 'react';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';

import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { haptics } from '@/src/utils/haptics';
import { useMountWhileOpen } from '../../hooks/use-mount-while-open';
import { FilterOptionRow } from './filter-option-row';
import { FilterSheetHeader } from './filter-sheet-header';

export type PickerOption = { value: string; label: string };

type OptionPickerSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  options: readonly PickerOption[];
  value: string;
  onPick: (value: string) => void;
};

/**
 * Nested picker for long option lists (Rank). Always uses BottomSheetScrollView
 * so dynamic sizing can measure content — a plain View/ScrollView can mount an
 * invisible sheet that still steals touches from the parent Filters drawer.
 */
export function OptionPickerSheet({
  isOpen,
  onClose,
  title,
  options,
  value,
  onPick,
}: OptionPickerSheetProps): ReactElement | null {
  const { shouldRender, sheetProps } = useMountWhileOpen(isOpen, onClose);
  if (!shouldRender) return null;

  return (
    <AppBottomSheet {...sheetProps} mode='dynamic' backdropOpacity={0.4}>
      <FilterSheetHeader title={title} onCancel={onClose} />
      <BottomSheetScrollView
        className='px-2'
        contentContainerStyle={{ paddingBottom: 16 }}
        style={{ maxHeight: 420 }}
      >
        {options.map(option => (
          <FilterOptionRow
            key={option.value || '__default__'}
            title={option.label}
            query=''
            isSelected={value === option.value}
            onPress={() => {
              void haptics.buttonTap();
              onPick(option.value);
            }}
          />
        ))}
      </BottomSheetScrollView>
    </AppBottomSheet>
  );
}
