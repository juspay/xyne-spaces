import type { Href } from 'expo-router';

import type { NavIcon } from './nav-icon';
import { memo, type ReactElement, useCallback } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useIsFocused } from 'expo-router/react-navigation';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { interpolate, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { entryHref, type TabEntry } from '../model/catalog';
import { useActiveTab } from '../hooks/use-active-tab';
import { useBarAnimation } from '../hooks/use-bar-animation';
import { useButtonGestures } from '../hooks/use-button-gestures';
import { usePillGestures } from '../hooks/use-pill-gestures';
import { useSpacesTabBarHeight } from '../hooks/use-bar-height';
import {
  PILL_HEIGHT,
  TAB_BAR_BLUR_FADE,
  TAB_BAR_BOTTOM_PADDING,
  TAB_BAR_HORIZONTAL_PADDING,
  TAB_BAR_SEARCH_HORIZONTAL_PADDING,
  menuHeightForCount,
} from '../constants';
import { TabBarBackdrop } from './backdrop';
import { TabBarPill } from './tab-bar-pill';
import { CloseSearchButton, SearchButton, type SearchFieldBinding } from './search-field';

export type TabBarProps = {
  activeIndex: number;
  icons: readonly NavIcon[];
  /** Announced labels per pill index, aligned with `icons`. */
  labels: readonly string[];
  /** Unread badge text per pill index, aligned with `icons`. */
  badgeLabels: readonly (string | null)[];
  /** Whether each pill switches tab, aligned with `icons`. Others push a screen. */
  pillSwitchesTab: readonly boolean[];
  /** Destinations the menu panel lists, in the user's order. */
  menuItems: readonly TabEntry[];
  menuBadgeLabels: Readonly<Record<string, string | null>>;
  menuDestinationIcon: NavIcon | null;
  activeMenuId: string | null;
  /** Whether the search screen is the one currently showing. */
  isSearchRoute: boolean;
  /**
   * Binds the bar's own search field. Absent — as in Part 1 — leaves the search
   * button a plain button and the search screen owns its input.
   */
  searchBinding?: SearchFieldBinding | undefined;
  onTabChange: (index: number) => void;
  onMenuSelect: (href: Href) => void;
  onSearchOpen: () => void;
  onSearchClose: () => void;
  onCustomize: () => void;
};

export const TabBar = memo(function TabBar({
  activeIndex,
  icons,
  labels,
  badgeLabels,
  pillSwitchesTab,
  menuItems,
  menuBadgeLabels,
  menuDestinationIcon,
  activeMenuId,
  isSearchRoute,
  searchBinding,
  onTabChange,
  onMenuSelect,
  onSearchOpen,
  onSearchClose,
  onCustomize,
}: TabBarProps): ReactElement {
  const isFocused = useIsFocused();
  const barHeight = useSpacesTabBarHeight();
  const barPaddingBottom = barHeight - PILL_HEIGHT;
  const chromeHeight = barPaddingBottom;
  const blurHeight = chromeHeight + TAB_BAR_BLUR_FADE;
  const blurStartOffset = chromeHeight / blurHeight;
  const { height: keyboardHeight, progress: keyboardProgress } = useReanimatedKeyboardAnimation();

  const {
    searchProgress,
    menuProgress,
    isSearchActive,
    isMenuOpen,
    toggleSearch,
    toggleMenu,
    pillAnimatedStyle,
  } = useBarAnimation(
    isSearchRoute,
    menuHeightForCount(menuItems.length),
    onSearchOpen,
    onSearchClose,
    searchBinding !== undefined,
  );

  const hoveredMenuItem = useSharedValue(-1);

  // Read the menu state off the shared value rather than React state, so this
  // callback stays stable and cannot rebuild the pill's gestures mid-touch.
  const handleMenuSelect = useCallback(
    (href: Href) => {
      if (menuProgress.get() > 0.5) toggleMenu();
      onMenuSelect(href);
    },
    [menuProgress, onMenuSelect, toggleMenu],
  );

  const handleCustomize = useCallback(() => {
    // No head start needed: the tray renders through a portal, so it no longer
    // covers a panel that is still folding away. Pushing a screen used to.
    if (menuProgress.get() > 0.5) toggleMenu();
    onCustomize();
  }, [menuProgress, onCustomize, toggleMenu]);

  const commitMenuItem = useCallback(
    (index: number) => {
      const entry = menuItems[index];
      if (entry === undefined) return;
      const href = entryHref(entry);
      if (href !== null) handleMenuSelect(href);
    },
    [handleMenuSelect, menuItems],
  );

  const activeTab = useActiveTab(activeIndex, onTabChange, pillSwitchesTab);
  const pill = usePillGestures(
    activeTab,
    searchProgress,
    menuProgress,
    toggleMenu,
    hoveredMenuItem,
    commitMenuItem,
    menuItems.length,
  );
  const search = useButtonGestures(toggleSearch);
  const close = useButtonGestures(toggleSearch);

  const keyboardStyle = useAnimatedStyle((): { transform: { translateY: number }[] } => ({
    transform: [{ translateY: keyboardHeight.get() }],
  }));

  /**
   * Closes the gap between the keyboard and the search field.
   *
   * The resting padding clears the home indicator, which the keyboard already
   * covers — so holding it there leaves a band of nothing between the two. It
   * collapses to the same padding a device without a home indicator gets,
   * which is the floor this bar was always willing to sit at.
   *
   * Both progresses have to be out, so this never touches the pill's resting
   * position: `searchProgress` because the field is the only thing that sits
   * against the keyboard, `keyboardProgress` because there is nothing to close
   * the gap to until it is up. Driven from shared values rather than
   * `isSearchActive` so it tracks the keyboard frame by frame instead of
   * stepping once React re-renders.
   */
  const containerStyle = useAnimatedStyle(
    (): { paddingBottom: number; paddingHorizontal: number } => {
      const search = searchProgress.get();

      return {
        paddingBottom: interpolate(
          Math.min(search, keyboardProgress.get()),
          [0, 1],
          [barPaddingBottom, TAB_BAR_BOTTOM_PADDING],
        ),
        // Tracks the field rather than the keyboard: the inset should already
        // be tight by the time the input finishes expanding, so the width it
        // settles into is the width it animated towards.
        paddingHorizontal: interpolate(
          search,
          [0, 1],
          [TAB_BAR_HORIZONTAL_PADDING, TAB_BAR_SEARCH_HORIZONTAL_PADDING],
        ),
      };
    },
  );

  return (
    <>
      {isMenuOpen ? <Pressable style={styles.backdrop} onPress={toggleMenu} /> : null}
      <Animated.View
        pointerEvents='box-none'
        style={[styles.frame, { minHeight: blurHeight }, keyboardStyle]}
      >
        {/*
          Always mounted, unlike the blur inside it. Gating the whole backdrop
          on focus unmounted the fade the instant a push began and remounted it
          only after the pop committed, so it trailed the bar on the way back in
          — the bar never unmounts, and the fade belongs to it.
        */}
        <TabBarBackdrop
          height={blurHeight}
          startOffset={blurStartOffset}
          isBlurEnabled={isFocused}
        />
        <Animated.View pointerEvents='box-none' style={[styles.container, containerStyle]}>
          <TabBarPill
            activeTab={activeTab.activeTab}
            hoveredTab={activeTab.hoveredTab}
            commitTab={activeTab.commitTab}
            onMenuPress={toggleMenu}
            icons={icons}
            labels={labels}
            activeIndex={activeIndex}
            badgeLabels={badgeLabels}
            searchProgress={searchProgress}
            menuProgress={menuProgress}
            pillAnimatedStyle={pillAnimatedStyle}
            pillPressed={pill.pillPressed}
            overflowX={pill.overflowX}
            overflowY={pill.overflowY}
            touchX={pill.touchX}
            touchY={pill.touchY}
            glowProgress={pill.glowProgress}
            panGesture={pill.panGesture}
            isMenuOpen={isMenuOpen}
            menuItems={menuItems}
            menuBadgeLabels={menuBadgeLabels}
            menuDestinationIcon={menuDestinationIcon}
            activeMenuId={activeMenuId}
            onMenuSelect={handleMenuSelect}
            onCustomize={handleCustomize}
            hoveredMenuItem={hoveredMenuItem}
          />
          <SearchButton
            searchProgress={searchProgress}
            isSearchActive={isSearchActive}
            binding={searchBinding}
            pressed={search.pressed}
            overflowX={search.overflowX}
            overflowY={search.overflowY}
            touchX={search.touchX}
            touchY={search.touchY}
            glowProgress={search.glowProgress}
            composedGesture={search.composedGesture}
          />
          <CloseSearchButton
            searchProgress={searchProgress}
            pressed={close.pressed}
            overflowX={close.overflowX}
            overflowY={close.overflowY}
            touchX={close.touchX}
            touchY={close.touchY}
            glowProgress={close.glowProgress}
            composedGesture={close.composedGesture}
          />
        </Animated.View>
      </Animated.View>
    </>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    zIndex: 1,
  },
  frame: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    justifyContent: 'flex-end',
    overflow: 'visible',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
});
