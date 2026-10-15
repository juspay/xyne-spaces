import type { Href } from 'expo-router';
import { SlidersHorizontal } from 'lucide-react-native';
import { memo, useCallback, useMemo, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, type ComposedGesture } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { entryHref, type TabEntry } from '../model/catalog';
import { haptics } from '@/src/utils/haptics';

import {
  BADGE_BACKGROUND,
  BADGE_TEXT,
  HOVER_FADE,
  MENU_HEADER_HEIGHT,
  NAV_ICON_STROKE_WIDTH,
  MENU_ITEM_HEIGHT,
  MENU_PADDING_HORIZONTAL,
  MENU_PADDING_TOP,
  SPRING_MENU_HOVER,
  menuItemAtY,
  useTabBarPalette,
} from '../constants';

const STAGGER_IN_MS = 40;
const STAGGER_OUT_MS = 10;
const ITEM_IN_DURATION = 250;
const ITEM_OUT_DURATION = 80;

/** How much the highlight squashes along its direction of travel. */
const MAX_STRETCH = 0.14;
const MAX_SQUEEZE = 0.05;

type MenuItemProps = {
  item: TabEntry;
  index: number;
  /** Total rows, so the closing stagger can run bottom-up without a shared list. */
  count: number;
  menuProgress: SharedValue<number>;
  badgeLabel: string | null;
  isActive: boolean;
};

const MenuItem = memo(function MenuItem({
  item,
  index,
  count,
  menuProgress,
  badgeLabel,
  isActive,
}: MenuItemProps): ReactElement {
  const palette = useTabBarPalette();
  const Icon = item.icon;

  /**
   * Each row owns its entry animation.
   *
   * Hoisting these to the panel is what pinned it to a fixed number of rows —
   * hooks cannot be written in a loop — and the list is the user's to resize
   * now. One shared value per row costs the same and has no such ceiling.
   */
  const progress = useSharedValue(0);
  const wasOpen = useSharedValue(false);

  useAnimatedReaction(
    () => menuProgress.get(),
    (current, previous) => {
      const goingUp = current > (previous ?? 0);

      if (goingUp && current > 0.1 && !wasOpen.get()) {
        wasOpen.set(true);
        progress.set(
          withDelay(index * STAGGER_IN_MS, withTiming(1, { duration: ITEM_IN_DURATION })),
        );
        return;
      }

      if (!goingUp && current < 0.95 && wasOpen.get()) {
        wasOpen.set(false);
        // Out is bottom-up, so the panel collapses towards the pill it came from.
        progress.set(
          withDelay(
            (count - 1 - index) * STAGGER_OUT_MS,
            withTiming(0, { duration: ITEM_OUT_DURATION }),
          ),
        );
      }
    },
  );

  const style = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: interpolate(progress.get(), [0, 1], [-10, 0]) }],
  }));

  return (
    <Animated.View style={style}>
      <View
        accessible
        accessibilityRole='button'
        accessibilityLabel={item.label}
        accessibilityState={{ selected: isActive }}
        style={[styles.menuItem, isActive ? { backgroundColor: palette.menuHighlight } : null]}
      >
        <Icon
          size={20}
          color={isActive ? palette.iconActive : palette.icon}
          strokeWidth={NAV_ICON_STROKE_WIDTH}
        />
        <Text style={[styles.menuItemLabel, { color: palette.textPrimary }]}>{item.label}</Text>
        {badgeLabel === null ? null : (
          <View style={styles.badge}>
            <Text allowFontScaling={false} style={styles.badgeLabel}>
              {badgeLabel}
            </Text>
          </View>
        )}
      </View>
    </Animated.View>
  );
});

export type MenuPanelProps = {
  menuProgress: SharedValue<number>;
  isMenuOpen: boolean;
  items: readonly TabEntry[];
  badgeLabels: Readonly<Record<string, string | null>>;
  activeMenuId: string | null;
  /**
   * Row the finger is over, or -1. Shared with the pill so a drag that opened
   * the menu keeps steering the same highlight.
   */
  hoveredMenuItem: SharedValue<number>;
  onSelect: (href: Href) => void;
  onCustomize: () => void;
};

/** Touch handling for the open panel: hover on contact, commit on release. */
function useMenuGesture(
  hoveredMenuItem: SharedValue<number>,
  items: readonly TabEntry[],
  onSelect: (href: Href) => void,
): ComposedGesture {
  const triggerHaptic = useCallback(() => {
    void haptics.buttonTap();
  }, []);

  const commit = useCallback(
    (index: number) => {
      const entry = items[index];
      if (entry === undefined) return;
      const href = entryHref(entry);
      if (href !== null) onSelect(href);
    },
    [items, onSelect],
  );

  const count = items.length;

  return useMemo(() => {
    // A zero-duration long press begins and finalizes for every touch on the
    // panel, whether or not the pan ever activates — so it is the one place a
    // selection is committed, and a tap and a slide take the same path.
    const press = Gesture.LongPress()
      .minDuration(0)
      .maxDistance(Number.MAX_SAFE_INTEGER)
      .onStart(event => {
        hoveredMenuItem.set(menuItemAtY(event.x, event.y, count));
      })
      .onFinalize(() => {
        const index = hoveredMenuItem.get();
        hoveredMenuItem.set(-1);
        if (index >= 0) {
          scheduleOnRN(triggerHaptic);
          scheduleOnRN(commit, index);
        }
      });

    const pan = Gesture.Pan()
      .minDistance(0)
      .onUpdate(event => {
        const next = menuItemAtY(event.x, event.y, count);
        if (next === hoveredMenuItem.get()) return;
        hoveredMenuItem.set(next);
        if (next >= 0) scheduleOnRN(triggerHaptic);
      });

    return Gesture.Simultaneous(press, pan);
  }, [commit, count, hoveredMenuItem, triggerHaptic]);
}

export function MenuPanel({
  menuProgress,
  isMenuOpen,
  items,
  badgeLabels,
  activeMenuId,
  hoveredMenuItem,
  onSelect,
  onCustomize,
}: MenuPanelProps): ReactElement {
  const palette = useTabBarPalette();
  const gesture = useMenuGesture(hoveredMenuItem, items, onSelect);

  // One highlight for the whole panel rather than a fade per row: a single
  // animated node to drive, and it reads as one surface sliding between rows.
  const hoverY = useSharedValue(0);
  const hoverOpacity = useSharedValue(0);

  useAnimatedReaction(
    () => hoveredMenuItem.get(),
    (index, previous) => {
      if (index < 0) {
        hoverOpacity.set(withTiming(0, HOVER_FADE));
        return;
      }
      const target = index * MENU_ITEM_HEIGHT;
      if (previous === null || previous < 0) {
        // First contact: appear under the finger rather than flying in.
        hoverY.set(target);
        hoverOpacity.set(withTiming(1, HOVER_FADE));
        return;
      }
      hoverY.set(withSpring(target, SPRING_MENU_HOVER));
      hoverOpacity.set(1);
    },
  );

  const travel = useSharedValue(0);
  useAnimatedReaction(
    () => {
      const index = hoveredMenuItem.get();
      if (index < 0) return 0;
      const target = index * MENU_ITEM_HEIGHT;
      return Math.min(Math.abs(target - hoverY.get()) / MENU_ITEM_HEIGHT, 1);
    },
    stretch => {
      travel.set(stretch);
    },
  );

  const hoverStyle = useAnimatedStyle(() => {
    const stretch = travel.get();
    return {
      opacity: hoverOpacity.get(),
      transform: [
        { translateY: hoverY.get() },
        { scaleY: 1 + stretch * MAX_STRETCH },
        { scaleX: 1 - stretch * MAX_SQUEEZE },
      ],
    };
  });

  const containerStyle = useAnimatedStyle(() => {
    const progress = menuProgress.get();
    return {
      opacity: progress,
      transform: [
        { scale: interpolate(progress, [0, 1], [0.8, 1]) },
        { translateY: interpolate(progress, [0, 1], [-200, 0]) },
      ],
    };
  });

  return (
    <Animated.View
      // Keeps VoiceOver inside the panel while it is out, instead of letting it
      // wander onto the screen behind.
      accessibilityViewIsModal={isMenuOpen}
      importantForAccessibility={isMenuOpen ? 'yes' : 'no-hide-descendants'}
      pointerEvents={isMenuOpen ? 'auto' : 'none'}
      style={[styles.container, containerStyle]}
    >
      {/*
        The drag surface spans the whole panel, so `event.y` here is in the same
        panel-local space the pill's own pan reports — `menuItemAtY` is fed by
        both and cannot be right for two different origins. Putting the detector
        on the rows alone shifted this path by the header's height and picked
        the row above the one under the finger.
      */}
      <GestureDetector gesture={gesture}>
        <View style={styles.surface} collapsable={false}>
          <View style={styles.items}>
            <Animated.View
              pointerEvents='none'
              style={[styles.hover, { backgroundColor: palette.menuHighlight }, hoverStyle]}
            />
            {items.map((item, index) => (
              <MenuItem
                key={item.id}
                item={item}
                index={index}
                count={items.length}
                menuProgress={menuProgress}
                badgeLabel={badgeLabels[item.id] ?? null}
                isActive={activeMenuId === item.id}
              />
            ))}
          </View>
        </View>
      </GestureDetector>

      {/*
        Drawn over the drag surface rather than inside it, so the button stays a
        button. The band it occupies maps to no row, so a press that falls
        beside it still resolves to nothing.
      */}
      <View pointerEvents='box-none' style={styles.header}>
        <Text style={[styles.headerLabel, { color: palette.textSecondary }]}>More</Text>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Customize navigation'
          hitSlop={10}
          onPress={onCustomize}
          style={[styles.configButton, { backgroundColor: palette.activeIndicator }]}
        >
          <SlidersHorizontal size={17} color={palette.iconActive} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
  },
  /**
   * Spans the whole panel so a touch reports panel-local coordinates, and
   * carries the padding so the rows below start exactly where `menuItemAtY`
   * expects them: MENU_PADDING_TOP + MENU_HEADER_HEIGHT.
   */
  surface: {
    ...StyleSheet.absoluteFill,
    paddingTop: MENU_PADDING_TOP,
    paddingHorizontal: MENU_PADDING_HORIZONTAL,
  },
  header: {
    position: 'absolute',
    top: MENU_PADDING_TOP,
    left: MENU_PADDING_HORIZONTAL,
    right: MENU_PADDING_HORIZONTAL,
    height: MENU_HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 12,
    paddingRight: 4,
  },
  headerLabel: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  configButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  items: {
    flex: 1,
    marginTop: MENU_HEADER_HEIGHT,
  },
  hover: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: MENU_ITEM_HEIGHT,
    borderRadius: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    height: MENU_ITEM_HEIGHT,
    paddingHorizontal: 12,
    borderRadius: 12,
    gap: 14,
  },
  menuItemLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: BADGE_BACKGROUND,
  },
  badgeLabel: {
    color: BADGE_TEXT,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 13,
  },
});
