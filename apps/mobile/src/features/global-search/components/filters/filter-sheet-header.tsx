import { type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

type FilterSheetHeaderProps = {
  title: string;
  /** Omit for tap-to-select sheets, which have nothing to cancel or commit. */
  onCancel?: () => void;
  onApply?: () => void;
};

/**
 * Shared sheet chrome: Cancel on the left, title centred, Apply on the right.
 * The side actions are laid out as equal-width flex columns so the title stays
 * optically centred whatever the labels are.
 */
export function FilterSheetHeader({
  title,
  onCancel,
  onApply,
}: FilterSheetHeaderProps): ReactElement {
  const { accentText } = useBubbleAccent();
  const hasActions = Boolean(onCancel || onApply);

  return (
    <View className='flex-row items-center px-4 pb-1 pt-1.5'>
      <View className='flex-1 items-start'>
        {onCancel ? (
          <Pressable
            accessibilityRole='button'
            hitSlop={10}
            onPress={onCancel}
            className='py-1 active:opacity-60'
          >
            <Text className='text-[15px] text-bottomsheet-text-muted'>Cancel</Text>
          </Pressable>
        ) : null}
      </View>

      <Text
        className='text-[16px] font-semibold text-bottomsheet-text-header'
        numberOfLines={1}
        style={hasActions ? undefined : { flex: 0 }}
      >
        {title}
      </Text>

      <View className='flex-1 items-end'>
        {onApply ? (
          <Pressable
            accessibilityRole='button'
            hitSlop={10}
            onPress={onApply}
            className='py-1 active:opacity-60'
          >
            <Text className='text-[15px] font-semibold' style={{ color: accentText }}>
              Apply
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
