import type { Href } from 'expo-router';

import type { NavIcon } from './nav-icon';
import { memo, type ReactElement, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useIsFocused } from 'expo-router/react-navigation';
import { useSharedValue } from 'react-native-reanimated';

import { entryHref, type TabEntry } from '../model/catalog';
import { useActiveTab } from '../hooks/use-active-tab';
import { useBarAnimation } from '../hooks/use-bar-animation';
import { usePillGestures } from '../hooks/use-pill-gestures';
import { useSpacesTabBarHeight } from '../hooks/use-bar-height';
import {
  PILL_HEIGHT,
  TAB_BAR_BLUR_FADE,
  TAB_BAR_HORIZONTAL_PADDING,
  menuHeightForCount,
} from '../constants';
import { AskAiButton } from './ask-ai-button';
import { TabBarBackdrop } from './backdrop';
import { TabBarPill } from './tab-bar-pill';

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
  onTabChange: (index: number) => void;
  onMenuSelect: (href: Href) => void;
  onAskAi: () => void;
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
  onTabChange,
  onMenuSelect,
  onAskAi,
  onCustomize,
}: TabBarProps): ReactElement {
  const isFocused = useIsFocused();
  const barHeight = useSpacesTabBarHeight();
  const barPaddingBottom = barHeight - PILL_HEIGHT;
  const chromeHeight = barPaddingBottom;
  const blurHeight = chromeHeight + TAB_BAR_BLUR_FADE;
  const blurStartOffset = chromeHeight / blurHeight;

  const { menuProgress, isMenuOpen, toggleMenu, pillAnimatedStyle } = useBarAnimation(
    menuHeightForCount(menuItems.length),
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
    menuProgress,
    toggleMenu,
    hoveredMenuItem,
    commitMenuItem,
    menuItems.length,
  );

  // Closes the menu first, so it is not left open behind Xyne AI.
  const handleAskAi = useCallback(() => {
    if (menuProgress.get() > 0.5) toggleMenu();
    onAskAi();
  }, [menuProgress, onAskAi, toggleMenu]);

  return (
    <>
      {isMenuOpen ? <Pressable style={styles.backdrop} onPress={toggleMenu} /> : null}
      <View pointerEvents='box-none' style={[styles.frame, { minHeight: blurHeight }]}>
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
        <View
          pointerEvents='box-none'
          style={[styles.container, { paddingBottom: barPaddingBottom }]}
        >
          <TabBarPill
            activeTab={activeTab.activeTab}
            hoveredTab={activeTab.hoveredTab}
            commitTab={activeTab.commitTab}
            onMenuPress={toggleMenu}
            icons={icons}
            labels={labels}
            activeIndex={activeIndex}
            badgeLabels={badgeLabels}
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
          <AskAiButton onPress={handleAskAi} />
        </View>
      </View>
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
    paddingHorizontal: TAB_BAR_HORIZONTAL_PADDING,
  },
});
