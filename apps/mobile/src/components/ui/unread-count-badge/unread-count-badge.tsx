import { memo, type ReactElement } from 'react';
import { Text, View } from 'react-native';

import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { formatCountLabel } from '@/src/utils/countLabel';

type UnreadCountBadgeSize = 'sm' | 'md';

type UnreadCountBadgeProps = {
  count: number;
  /** `sm` for dense rows and tab strips, `md` for list rows. */
  size?: UnreadCountBadgeSize;
};

const SIZES: Record<UnreadCountBadgeSize, { container: string; label: string }> = {
  sm: { container: 'h-5 min-w-5 px-1.5', label: 'text-[11px]' },
  md: { container: 'h-[22px] min-w-[22px] px-1.5', label: 'text-[12px]' },
};

/**
 * The numeric badge shown against a channel, conversation or tab.
 *
 * Colour follows the user's chat bubble choice — `accentFg` rather than a
 * hardcoded white, which is unreadable on the pale end of the palette.
 *
 * Renders whatever count it is handed, including zero. Every caller already
 * decides whether a badge belongs there at all, and one call site is asserted
 * to render "0", so the visibility rule stays with them.
 */
export const UnreadCountBadge = memo(function UnreadCountBadge({
  count,
  size = 'md',
}: UnreadCountBadgeProps): ReactElement {
  const { accentBg, accentFg } = useBubbleAccent();
  const variant = SIZES[size];

  return (
    <View
      className={`${variant.container} items-center justify-center rounded-full`}
      style={{ backgroundColor: accentBg }}
    >
      <Text className={`${variant.label} font-semibold leading-none`} style={{ color: accentFg }}>
        {formatCountLabel(count)}
      </Text>
    </View>
  );
});
