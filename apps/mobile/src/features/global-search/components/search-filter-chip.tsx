/**
 * A picked `from:` / `in:` filter inside the search pill. Not a `Badge`: it has to fit
 * the 44pt pill, so the type and padding are tighter and the remove target gets its
 * size from `hitSlop`.
 */

import { memo, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';
import { haptics } from '@/src/utils/haptics';
import { X } from 'lucide-react-native';

import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import type { SearchFilterChip } from '../types';

const GLYPH_SIZE = 12;

type SearchFilterChipViewProps = {
  chip: SearchFilterChip;
  /** `From` / `With` / `In` — see `filterChipTitle`. */
  prefixLabel: string;
  onRemove: (chip: SearchFilterChip) => void;
};

export const SearchFilterChipView = memo(function SearchFilterChipView({
  chip,
  prefixLabel,
  onRemove,
}: SearchFilterChipViewProps): ReactElement {
  const { accentSoft, accentText } = useBubbleAccent();
  const label = `${prefixLabel}: ${chip.label}`;

  return (
    <View
      className='mr-1.5 max-w-[200px] flex-row items-center gap-1 rounded-md border-[0.5px] px-1 py-0.5'
      style={{ backgroundColor: accentSoft, borderColor: accentText }}
    >
      <Text
        className='min-w-0 shrink text-[13px] font-semibold'
        style={{ color: accentText }}
        numberOfLines={1}
        ellipsizeMode='tail'
      >
        {label}
      </Text>
      {/*
        Generous hitSlop rather than padding: the touch target has to clear the
        44pt minimum, but growing the chip to hold one would cost the tightness
        the field is going for.
      */}
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={`Remove ${label}`}
        hitSlop={12}
        onPress={() => {
          void haptics.buttonTap();
          onRemove(chip);
        }}
        className='active:opacity-70'
      >
        <X size={GLYPH_SIZE} color={accentText} strokeWidth={2.5} />
      </Pressable>
    </View>
  );
});
