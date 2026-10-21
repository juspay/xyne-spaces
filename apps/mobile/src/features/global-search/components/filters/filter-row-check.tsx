import { type ReactElement } from 'react';
import { View } from 'react-native';
import { Check } from 'lucide-react-native';
import { useCSSVariable } from 'uniwind';

import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { withAlpha } from '@/src/utils/color';

/** Trailing multi-select affordance shared by the filter sheets. */
export function FilterRowCheck({ isSelected }: { isSelected: boolean }): ReactElement {
  const { accentBg, accentFg } = useBubbleAccent();
  const foregroundColor = useCSSVariable('--color-foreground') as string;

  return (
    <View
      pointerEvents='none'
      className='ml-3 size-6 items-center justify-center rounded-full border'
      style={{
        backgroundColor: isSelected ? accentBg : 'transparent',
        borderColor: isSelected ? accentBg : withAlpha(foregroundColor, 0.25),
      }}
    >
      {isSelected ? <Check size={14} color={accentFg} strokeWidth={3} /> : null}
    </View>
  );
}
