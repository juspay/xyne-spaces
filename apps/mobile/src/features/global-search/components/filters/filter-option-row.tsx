import { type ReactElement, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { haptics } from '@/src/utils/haptics';
import { HighlightedText } from '../highlighted-text';
import { FilterRowCheck } from './filter-row-check';

type FilterOptionRowProps = {
  /** Avatar for people and DMs, a glyph badge for channels. */
  leading: ReactNode;
  title: string;
  subtitle?: string;
  query: string;
  isSelected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
};

/**
 * A selectable row inside a filter sheet.
 *
 * Deliberately not the search-results row: those carry 48pt avatars and an
 * inset hairline divider, which is right for a dense results list and wrong for
 * a picker. This one is tighter, divider-free, and puts the selection state at
 * the trailing edge.
 */
// Not memo'd: `leading` is a freshly-created element and `onPress` a fresh
// closure at both call sites, so a memo could never short-circuit.
export function FilterOptionRow({
  leading,
  title,
  subtitle,
  query,
  isSelected,
  onPress,
  accessibilityLabel,
}: FilterOptionRowProps): ReactElement {
  return (
    <Pressable
      accessibilityRole='checkbox'
      accessibilityState={{ checked: isSelected }}
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      onPressIn={(): void => {
        void haptics.buttonTap();
      }}
      className='flex-row items-center gap-3 rounded-xl px-1 py-2.5 active:opacity-60'
    >
      {leading}
      <View className='min-w-0 flex-1'>
        <HighlightedText
          value={title}
          query={query}
          className='text-[15px] font-medium text-bottomsheet-container-foreground'
        />
        {subtitle ? (
          <HighlightedText
            value={subtitle}
            query={query}
            className='mt-0.5 text-[13px] text-bottomsheet-text-muted'
          />
        ) : null}
      </View>
      <FilterRowCheck isSelected={isSelected} />
    </Pressable>
  );
}
