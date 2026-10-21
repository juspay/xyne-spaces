import { type ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import type { DragSelector as DragSelectorValues } from '../hooks/use-pill-gestures';
import { INDICATOR_INSET, INDICATOR_RADIUS, TAB_ZONE_WIDTH, useTabBarPalette } from '../constants';

/**
 * The highlight a drag across the pill carries — one tab wide, centred on
 * `x + offset`. Drawn behind the icons, in the pill's own coordinates.
 */
export function DragSelector({ selector }: { selector: DragSelectorValues }): ReactElement {
  const palette = useTabBarPalette();

  const style = useAnimatedStyle(() => ({
    opacity: selector.visible.get(),
    transform: [{ translateX: selector.x.get() + selector.offset.get() - TAB_ZONE_WIDTH / 2 }],
  }));

  return (
    <Animated.View
      pointerEvents='none'
      style={[styles.selector, { backgroundColor: palette.activeIndicator }, style]}
    />
  );
}

const styles = StyleSheet.create({
  selector: {
    position: 'absolute',
    left: 0,
    top: INDICATOR_INSET,
    bottom: INDICATOR_INSET,
    width: TAB_ZONE_WIDTH,
    borderRadius: INDICATOR_RADIUS,
  },
});
