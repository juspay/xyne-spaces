import type { Href } from 'expo-router';

import type { NavIcon } from './nav-icon';
import { memo, type ReactElement } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { GestureDetector, type ComposedGesture } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  type AnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import type { TabEntry } from '../model/catalog';

import { GlassMaterial } from './glass-material';
import { MenuPanel } from './menu-panel';
import { GlowOverlay } from './search-field';
import { TabIcon } from './tab-icon';
import {
  ICON_PADDING,
  MENU_BORDER_RADIUS,
  MENU_TAB_INDEX,
  PILL_BORDER_RADIUS,
  PILL_HEIGHT,
  PILL_WIDTH,
  liquidGlassTransform,
} from '../constants';

const HALF_W = PILL_WIDTH / 2;
const HALF_H = PILL_HEIGHT / 2;
const GLOW_SIZE = 200;

export type TabBarPillProps = {
  activeTab: SharedValue<number>;
  hoveredTab: SharedValue<number>;
  /** Worklet. Moves the active highlight to a tab and navigates there. */
  commitTab: (index: number) => void;
  onMenuPress: () => void;
  icons: readonly NavIcon[];
  /** Announced labels per pill index, aligned with `icons`. */
  labels: readonly string[];
  /** Index of the current screen, for the accessibility tree. */
  activeIndex: number;
  /** Unread badge text per pill index, aligned with `icons`. */
  badgeLabels: readonly (string | null)[];
  searchProgress: SharedValue<number>;
  menuProgress: SharedValue<number>;
  pillAnimatedStyle: AnimatedStyle<ViewStyle>;
  pillPressed: SharedValue<number>;
  overflowX: SharedValue<number>;
  overflowY: SharedValue<number>;
  touchX: SharedValue<number>;
  touchY: SharedValue<number>;
  glowProgress: SharedValue<number>;
  panGesture: ComposedGesture;
  isMenuOpen: boolean;
  menuItems: readonly TabEntry[];
  menuBadgeLabels: Readonly<Record<string, string | null>>;
  menuDestinationIcon: NavIcon | null;
  activeMenuId: string | null;
  onMenuSelect: (href: Href) => void;
  onCustomize: () => void;
  hoveredMenuItem: SharedValue<number>;
};

export const TabBarPill = memo(function TabBarPill({
  activeTab,
  hoveredTab,
  commitTab,
  onMenuPress,
  icons,
  labels,
  activeIndex,
  badgeLabels,
  searchProgress,
  menuProgress,
  pillAnimatedStyle,
  pillPressed,
  overflowX,
  overflowY,
  touchX,
  touchY,
  glowProgress,
  panGesture,
  isMenuOpen,
  menuItems,
  menuBadgeLabels,
  menuDestinationIcon,
  activeMenuId,
  onMenuSelect,
  onCustomize,
  hoveredMenuItem,
}: TabBarPillProps): ReactElement {
  const animatedBorderRadius = useDerivedValue(() =>
    interpolate(menuProgress.get(), [0, 0.8], [PILL_BORDER_RADIUS, MENU_BORDER_RADIUS], 'clamp'),
  );

  const pillGlassStyle = useAnimatedStyle(() => {
    if (menuProgress.get() > 0.5) {
      return { transform: [{ translateX: 0 }, { translateY: 0 }, { scaleX: 1 }, { scaleY: 1 }] };
    }
    return liquidGlassTransform(
      pillPressed.get(),
      overflowX.get(),
      overflowY.get(),
      HALF_W,
      HALF_H,
    );
  });

  return (
    <Animated.View style={pillGlassStyle}>
      <Animated.View style={[styles.pill, pillAnimatedStyle]}>
        <GlassMaterial borderRadius={animatedBorderRadius} style={styles.glassMaterial}>
          <GestureDetector gesture={panGesture}>
            {/* The panel covers the icon row once the menu is out. Letting the
                row keep its touches would put the pill's tab detector under
                the first menu rows. */}
            <View
              collapsable={false}
              style={styles.iconsRow}
              pointerEvents={isMenuOpen ? 'none' : 'auto'}
            >
              {icons.map((icon, index) => (
                <TabIcon
                  key={index}
                  index={index}
                  icon={icon}
                  activeTab={activeTab}
                  hoveredTab={hoveredTab}
                  commitTab={commitTab}
                  onMenuPress={onMenuPress}
                  isMenuTab={index === MENU_TAB_INDEX}
                  label={labels[index] ?? ''}
                  isActive={activeIndex === index}
                  badgeLabel={badgeLabels[index] ?? null}
                  menuDestinationIcon={index === MENU_TAB_INDEX ? menuDestinationIcon : null}
                  searchProgress={searchProgress}
                  menuProgress={menuProgress}
                  pillPressed={pillPressed}
                  touchX={touchX}
                  touchY={touchY}
                  glowProgress={glowProgress}
                />
              ))}
            </View>
          </GestureDetector>
          <MenuPanel
            menuProgress={menuProgress}
            isMenuOpen={isMenuOpen}
            items={menuItems}
            badgeLabels={menuBadgeLabels}
            activeMenuId={activeMenuId}
            hoveredMenuItem={hoveredMenuItem}
            onSelect={onMenuSelect}
            onCustomize={onCustomize}
          />
          <GlowOverlay
            size={GLOW_SIZE}
            id='pillGlow'
            touchX={touchX}
            touchY={touchY}
            glowProgress={glowProgress}
          />
        </GlassMaterial>
      </Animated.View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  pill: {
    justifyContent: 'flex-start',
  },
  glassMaterial: {
    flex: 1,
    alignSelf: 'stretch',
    minWidth: 0,
  },
  // No vertical padding: every tab owns the pill's full height so a touch near
  // the top or bottom edge still reaches a tab. The highlight is inset instead.
  iconsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: PILL_HEIGHT,
    paddingHorizontal: ICON_PADDING,
    gap: 0,
  },
});
