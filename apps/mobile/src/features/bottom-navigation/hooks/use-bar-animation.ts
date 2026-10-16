import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, type ViewStyle } from 'react-native';
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
  SPRING,
  SPRING_MENU_CLOSE,
  SPRING_MENU_OPEN,
  TAB_BAR_GAP,
} from '../constants';
import { useLatest } from './use-latest';

type TabBarAnimation = {
  searchProgress: SharedValue<number>;
  menuProgress: SharedValue<number>;
  isSearchActive: boolean;
  isMenuOpen: boolean;
  toggleSearch: () => void;
  toggleMenu: () => void;
  pillAnimatedStyle: AnimatedStyle<ViewStyle>;
};

export function useBarAnimation(
  isSearchRoute: boolean,
  menuHeight: number,
  onSearchOpen: () => void,
  onSearchClose: () => void,
  /**
   * Whether the pill may morph into a search field.
   *
   * The field only works once it is bound to the search store, which is Part 1b.
   * Until then the morph would put a second, dead input over the one the search
   * screen already renders — and because it is not editable, a tap on it falls
   * through to the bar's gesture and closes search instead.
   */
  canMorphSearch: boolean,
): TabBarAnimation {
  const searchProgress = useSharedValue(canMorphSearch && isSearchRoute ? 1 : 0);
  const menuProgress = useSharedValue(0);
  const [isSearchActive, setIsSearchActive] = useState(isSearchRoute);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const isSearchRouteRef = useLatest(isSearchRoute);

  /**
   * Navigation is the source of truth for whether the field is out — the same
   * contract `useActiveTab` follows for the active pill. Driving the morph from
   * the route rather than from the tap means leaving search by any other path
   * (a pill tap, a menu destination, a back gesture) collapses it too, instead
   * of stranding an open field over a screen that is no longer search.
   *
   * The keyboard is dismissed on the way out for the same reason: only the
   * close button can do it for itself, and every other exit would otherwise
   * leave it raised over the screen search was left for. Guarded on an actual
   * departure so the first render cannot dismiss a keyboard it never raised.
   */
  const wasSearchRoute = useRef(isSearchRoute);
  useEffect(() => {
    if (wasSearchRoute.current && !isSearchRoute) Keyboard.dismiss();
    wasSearchRoute.current = isSearchRoute;

    const expanded = canMorphSearch && isSearchRoute;
    setIsSearchActive(expanded);
    searchProgress.set(withSpring(expanded ? 1 : 0, SPRING));
  }, [canMorphSearch, isSearchRoute, searchProgress]);

  const toggleSearch = useCallback(() => {
    if (menuProgress.get() > 0.5) return;
    if (isSearchRouteRef.current) {
      onSearchClose();
      return;
    }
    onSearchOpen();
  }, [isSearchRouteRef, menuProgress, onSearchClose, onSearchOpen]);

  const toggleMenu = useCallback(() => {
    if (searchProgress.get() > 0.5) return;
    const opening = menuProgress.get() < 0.5;
    cancelAnimation(menuProgress);
    menuProgress.set(withSpring(opening ? 1 : 0, opening ? SPRING_MENU_OPEN : SPRING_MENU_CLOSE));
    setIsMenuOpen(opening);
  }, [menuProgress, searchProgress]);

  const pillAnimatedStyle = useAnimatedStyle(() => {
    const search = searchProgress.get();
    const menu = menuProgress.get();

    if (menu > 0.01) {
      return {
        width: PILL_WIDTH,
        height: interpolate(menu, [0, 0.1, 1], [PILL_HEIGHT, PILL_HEIGHT, menuHeight]),
        opacity: 1,
        marginRight: TAB_BAR_GAP,
        borderRadius: interpolate(
          menu,
          [0, 0.8],
          [PILL_BORDER_RADIUS, MENU_BORDER_RADIUS],
          'clamp',
        ),
        transform: [
          { translateX: 0 },
          { scaleX: interpolate(menu, [0, 0.15, 0.5, 0.85], [1, 0.7, 0.85, 1], 'clamp') },
        ],
      };
    }

    return {
      width: interpolate(search, [0, 0.6], [PILL_WIDTH, 0], 'clamp'),
      height: PILL_HEIGHT,
      opacity: interpolate(search, [0, 0.3], [1, 0], 'clamp'),
      marginRight: interpolate(search, [0, 0.6], [TAB_BAR_GAP, 0], 'clamp'),
      borderRadius: PILL_BORDER_RADIUS,
      transform: [
        { translateX: interpolate(search, [0, 0.6], [0, -PILL_WIDTH * 0.3], 'clamp') },
        { scaleX: 1 },
      ],
    };
  });

  return {
    searchProgress,
    menuProgress,
    isSearchActive,
    isMenuOpen,
    toggleSearch,
    toggleMenu,
    pillAnimatedStyle,
  };
}
