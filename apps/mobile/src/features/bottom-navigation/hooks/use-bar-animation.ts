import { useCallback, useState } from 'react';
import { type ViewStyle } from 'react-native';
import {
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type AnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import {
  MENU_BORDER_RADIUS,
  PILL_BORDER_RADIUS,
  PILL_HEIGHT,
  PILL_WIDTH,
  SPRING_MENU_CLOSE,
  SPRING_MENU_OPEN,
  TAB_BAR_GAP,
} from '../constants';

type TabBarAnimation = {
  menuProgress: SharedValue<number>;
  isMenuOpen: boolean;
  toggleMenu: () => void;
  pillAnimatedStyle: AnimatedStyle<ViewStyle>;
};

/** The pill unfolding into the destinations menu, and back. */
export function useBarAnimation(menuHeight: number): TabBarAnimation {
  const menuProgress = useSharedValue(0);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const toggleMenu = useCallback(() => {
    const opening = menuProgress.get() < 0.5;
    cancelAnimation(menuProgress);
    menuProgress.set(withSpring(opening ? 1 : 0, opening ? SPRING_MENU_OPEN : SPRING_MENU_CLOSE));
    setIsMenuOpen(opening);
  }, [menuProgress]);

  const pillAnimatedStyle = useAnimatedStyle(() => {
    const menu = menuProgress.get();

    return {
      width: PILL_WIDTH,
      height: interpolate(menu, [0, 0.1, 1], [PILL_HEIGHT, PILL_HEIGHT, menuHeight]),
      marginRight: TAB_BAR_GAP,
      borderRadius: interpolate(menu, [0, 0.8], [PILL_BORDER_RADIUS, MENU_BORDER_RADIUS], 'clamp'),
      transform: [{ scaleX: interpolate(menu, [0, 0.15, 0.5, 0.85], [1, 0.7, 0.85, 1], 'clamp') }],
    };
  });

  return { menuProgress, isMenuOpen, toggleMenu, pillAnimatedStyle };
}
