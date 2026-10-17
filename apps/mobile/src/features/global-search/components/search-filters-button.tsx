import { useCallback, useMemo, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ListFilter } from 'lucide-react-native';
import { useCSSVariable, useUniwind } from 'uniwind';

import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { haptics } from '@/src/utils/haptics';
import { withAlpha } from '@/src/utils/color';
import { SEARCH_BAR_HEIGHT, SEARCH_BAR_ICON_SIZE } from '../constants';

const styles = StyleSheet.create({
  button: {
    width: SEARCH_BAR_HEIGHT,
    height: SEARCH_BAR_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: SEARCH_BAR_HEIGHT / 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
});

type SearchFiltersButtonProps = {
  onPress: () => void;
  /** Active modal filters for the badge. */
  badgeCount?: number;
  /** Override height when the control sits beside the shorter category row. */
  size?: number;
};

/**
 * Opens the Filters sheet. Lives to the right of the search pill, or beside the
 * category tags when the field is hosted in the bottom bar.
 */
export function SearchFiltersButton({
  onPress,
  badgeCount = 0,
  size = SEARCH_BAR_HEIGHT,
}: SearchFiltersButtonProps): ReactElement {
  const inputColor = useCSSVariable('--color-input') as string;
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const mutedColor = useCSSVariable('--color-secondary-text') as string;
  const { theme } = useUniwind();
  const { accentText } = useBubbleAccent();

  const buttonStyle = useMemo(
    () => ({
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: inputColor,
      borderColor: withAlpha(foregroundColor, theme === 'dark' ? 0.08 : 0.06),
    }),
    [foregroundColor, inputColor, size, theme],
  );

  const handlePress = useCallback(() => {
    void haptics.buttonTap();
    onPress();
  }, [onPress]);

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={badgeCount > 0 ? `Filters, ${badgeCount} active` : 'Filters'}
      hitSlop={8}
      onPress={handlePress}
      style={[styles.button, buttonStyle]}
    >
      <ListFilter size={SEARCH_BAR_ICON_SIZE} color={badgeCount > 0 ? accentText : mutedColor} />
      {badgeCount > 0 ? (
        <View style={[styles.badge, { backgroundColor: accentText }]}>
          <Text style={styles.badgeText}>{badgeCount > 9 ? '9+' : String(badgeCount)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
