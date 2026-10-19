import { memo, type ReactElement, useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { ChevronsIcon } from '../icons';
import { haptics } from '@/src/utils/haptics';

import {
  HOVER_FADE,
  ICON_SIZE,
  NAV_ICON_STROKE_WIDTH,
  INDICATOR_FADE,
  INDICATOR_INSET,
  PILL_BORDER_RADIUS,
  PILL_HEIGHT,
  PILL_WIDTH,
  BADGE_BACKGROUND,
  BADGE_FONT_SIZE,
  BADGE_HEIGHT,
  BADGE_OFFSET_RIGHT,
  BADGE_OFFSET_TOP,
  BADGE_PADDING_HORIZONTAL,
  BADGE_TEXT,
  tabCenterX,
  useTabBarPalette,
} from '../constants';
import { navIcon, type NavIcon } from './nav-icon';

const CHEVRON_BADGE_SIZE = 13;
const ICON_SWAP = { duration: 280, easing: Easing.out(Easing.cubic) } as const;
const ChevronBadgeIcon = navIcon(ChevronsIcon);

export type TabIconProps = {
  index: number;
  icon: NavIcon;
  /** Tab whose highlight reads as "current screen", or -1 when none does. */
  activeTab: SharedValue<number>;
  /** Tab the finger is over, or -1. Owns the highlight while a touch is down. */
  hoveredTab: SharedValue<number>;
  /** Worklet. Moves the active highlight to `index` and navigates there. */
  commitTab: (index: number) => void;
  /** Runs on the JS thread when the menu trigger is tapped. */
  onMenuPress: () => void;
  /** The last pill icon opens the menu instead of switching screens. */
  isMenuTab: boolean;
  /** What the tab announces. */
  label: string;
  /**
   * Whether this tab is the current screen, as a plain boolean.
   *
   * The highlight reads `activeTab` on the UI thread, but a screen reader reads
   * the accessibility tree — which shared values never touch. This is the only
   * way the selected state is announced, and it costs one render per switch.
   */
  isActive: boolean;
  /**
   * Unread badge text, already capped, or null for none. Only the three
   * switchable tabs ever carry one.
   */
  badgeLabel: string | null;
  menuDestinationIcon: NavIcon | null;
  searchProgress: SharedValue<number>;
  menuProgress: SharedValue<number>;
  pillPressed: SharedValue<number>;
  touchX: SharedValue<number>;
  touchY: SharedValue<number>;
  glowProgress: SharedValue<number>;
};

export const TabIcon = memo(function TabIcon({
  index,
  icon: Icon,
  activeTab,
  hoveredTab,
  commitTab,
  onMenuPress,
  isMenuTab,
  label,
  isActive,
  badgeLabel,
  menuDestinationIcon,
  searchProgress,
  menuProgress,
  pillPressed,
  touchX,
  touchY,
  glowProgress,
}: TabIconProps): ReactElement {
  const palette = useTabBarPalette();
  const destinationProgress = useSharedValue(menuDestinationIcon ? 1 : 0);
  const latchedDestination = useRef<NavIcon | null>(menuDestinationIcon);
  const DestinationIcon = menuDestinationIcon ?? latchedDestination.current;

  useEffect(() => {
    if (menuDestinationIcon) latchedDestination.current = menuDestinationIcon;
    destinationProgress.set(withTiming(menuDestinationIcon ? 1 : 0, ICON_SWAP));
  }, [destinationProgress, menuDestinationIcon]);

  const triggerHaptic = useCallback(() => {
    void haptics.buttonTap();
  }, []);

  const tap = useMemo(
    () =>
      Gesture.Tap()
        .onBegin(() => {
          touchX.set(tabCenterX(index));
          touchY.set(PILL_HEIGHT / 2);
          pillPressed.set(withTiming(1, { duration: 80 }));
          cancelAnimation(glowProgress);
          glowProgress.set(1);
          if (searchProgress.get() < 0.5) hoveredTab.set(index);
        })
        // The pill's own gesture cancels this tap the moment it activates, so
        // the press has to be acted on here rather than in `onEnd`.
        .onFinalize(() => {
          pillPressed.set(withTiming(0, { duration: 150 }));
          glowProgress.set(withTiming(2, { duration: 300 }));
          scheduleOnRN(triggerHaptic);
          if (isMenuTab) {
            hoveredTab.set(-1);
            scheduleOnRN(onMenuPress);
            return;
          }
          commitTab(index);
        }),
    [
      commitTab,
      glowProgress,
      hoveredTab,
      index,
      isMenuTab,
      onMenuPress,
      pillPressed,
      searchProgress,
      touchX,
      touchY,
      triggerHaptic,
    ],
  );

  const iconAnimatedStyle = useAnimatedStyle(() => {
    const search = searchProgress.get();
    const menu = menuProgress.get();

    if (menu > 0.01) {
      const toCenter = PILL_WIDTH / 2 - tabCenterX(index);
      return {
        opacity: interpolate(menu, [0.15, 0.5], [1, 0], 'clamp'),
        flex: 1,
        width: undefined,
        overflow: 'hidden' as const,
        transform: [
          { translateX: interpolate(menu, [0.15, 0.5], [0, toCenter], 'clamp') },
          { scale: interpolate(menu, [0.15, 0.5], [1, 0.3], 'clamp') },
        ],
      };
    }

    if (index === 0) {
      return {
        opacity: 1,
        flex: 1,
        width: undefined,
        overflow: 'hidden' as const,
        transform: [{ translateX: 0 }, { scale: 1 }],
      };
    }

    return {
      opacity: interpolate(search, [0, 0.3], [1, 0], 'clamp'),
      flex: interpolate(search, [0, 0.3], [1, 0], 'clamp'),
      width: undefined,
      overflow: 'hidden' as const,
      transform: [{ translateX: 0 }, { scale: interpolate(search, [0, 0.3], [1, 0.5], 'clamp') }],
    };
  });

  /**
   * A single highlight per tab. A touch takes it over as press feedback,
   * otherwise it follows the active tab. Driving both from one value means the
   * press → commit handover happens in one frame with no gap and no overlap.
   */
  const indicatorProgress = useDerivedValue(() => {
    const hovered = hoveredTab.get();
    const isHovering = hovered !== -1;
    const lit = (isHovering ? hovered : activeTab.get()) === index;
    return withTiming(lit ? 1 : 0, isHovering ? HOVER_FADE : INDICATOR_FADE);
  });

  /** Icon contrast follows the active tab only — a press must not recolour it. */
  const activeProgress = useDerivedValue(() =>
    withTiming(activeTab.get() === index ? 1 : 0, INDICATOR_FADE),
  );

  const indicatorStyle = useAnimatedStyle(() => ({ opacity: indicatorProgress.get() }));

  const restColorStyle = useAnimatedStyle(() => ({ opacity: 1 - activeProgress.get() }));

  const activeColorStyle = useAnimatedStyle(() => ({ opacity: activeProgress.get() }));

  const restIconStyle = useAnimatedStyle(() => ({
    opacity: 1 - destinationProgress.get(),
    transform: [{ scale: interpolate(destinationProgress.get(), [0, 1], [1, 0.72]) }],
  }));

  const destinationIconStyle = useAnimatedStyle(() => ({
    opacity: destinationProgress.get(),
    transform: [{ scale: interpolate(destinationProgress.get(), [0, 1], [0.72, 1]) }],
  }));

  const badgeStyle = useAnimatedStyle(() => ({
    opacity: destinationProgress.get(),
    transform: [{ scale: interpolate(destinationProgress.get(), [0, 1], [0.4, 1]) }],
  }));

  const circleFillStyle = useAnimatedStyle(() => ({
    opacity: destinationProgress.get(),
  }));

  return (
    <GestureDetector gesture={tap}>
      <Animated.View
        accessible
        accessibilityRole={isMenuTab ? 'button' : 'tab'}
        accessibilityLabel={label}
        accessibilityState={isMenuTab ? undefined : { selected: isActive }}
        accessibilityHint={badgeLabel === null ? undefined : `${badgeLabel} unread`}
        style={[styles.container, iconAnimatedStyle]}
      >
        {isMenuTab ? (
          <Animated.View
            pointerEvents='none'
            style={[
              styles.indicator,
              { backgroundColor: palette.activeIndicator },
              circleFillStyle,
            ]}
          />
        ) : null}
        <Animated.View
          pointerEvents='none'
          style={[styles.indicator, { backgroundColor: palette.activeIndicator }, indicatorStyle]}
        />
        <View style={styles.iconWrapper}>
          {isMenuTab ? (
            <>
              <Animated.View pointerEvents='none' style={[styles.stackedIcon, restIconStyle]}>
                <Icon size={ICON_SIZE} color={palette.icon} strokeWidth={NAV_ICON_STROKE_WIDTH} />
              </Animated.View>
              {DestinationIcon ? (
                <Animated.View
                  pointerEvents='none'
                  style={[styles.stackedIcon, destinationIconStyle]}
                >
                  <DestinationIcon
                    size={ICON_SIZE}
                    color={palette.iconActive}
                    strokeWidth={NAV_ICON_STROKE_WIDTH}
                  />
                </Animated.View>
              ) : null}
              {DestinationIcon ? (
                <Animated.View pointerEvents='none' style={[styles.chevronBadge, badgeStyle]}>
                  <ChevronBadgeIcon size={CHEVRON_BADGE_SIZE} color={palette.iconActive} />
                </Animated.View>
              ) : null}
            </>
          ) : (
            <>
              <Animated.View pointerEvents='none' style={[styles.stackedIcon, restColorStyle]}>
                <Icon size={ICON_SIZE} color={palette.icon} strokeWidth={NAV_ICON_STROKE_WIDTH} />
              </Animated.View>
              <Animated.View pointerEvents='none' style={[styles.stackedIcon, activeColorStyle]}>
                <Icon
                  size={ICON_SIZE}
                  color={palette.iconActive}
                  strokeWidth={NAV_ICON_STROKE_WIDTH}
                />
              </Animated.View>
            </>
          )}
          {badgeLabel === null ? null : (
            <View pointerEvents='none' style={styles.badge}>
              <Text numberOfLines={1} allowFontScaling={false} style={styles.badgeLabel}>
                {badgeLabel}
              </Text>
            </View>
          )}
        </View>
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: PILL_BORDER_RADIUS,
  },
  // Inset vertically so the highlight sits inside the pill while the tab itself
  // stays tappable across the pill's full height.
  indicator: {
    position: 'absolute',
    top: INDICATOR_INSET,
    bottom: INDICATOR_INSET,
    left: 0,
    right: 0,
    borderRadius: PILL_BORDER_RADIUS,
  },
  iconWrapper: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stackedIcon: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Inside the icon wrapper so it inherits the icon's fade and travel when the
  // pill turns into the menu or the search field.
  //
  // Width is left to the content: one digit renders a circle, and two or three
  // grow it leftwards from the same anchor rather than pushing past the tab.
  badge: {
    position: 'absolute',
    top: BADGE_OFFSET_TOP,
    right: BADGE_OFFSET_RIGHT,
    minWidth: BADGE_HEIGHT,
    height: BADGE_HEIGHT,
    paddingHorizontal: BADGE_PADDING_HORIZONTAL,
    borderRadius: BADGE_HEIGHT / 2,
    backgroundColor: BADGE_BACKGROUND,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLabel: {
    color: BADGE_TEXT,
    fontSize: BADGE_FONT_SIZE,
    fontWeight: '700',
    // The glyph box is taller than the digits; without this the label sits low.
    lineHeight: BADGE_FONT_SIZE + 2,
  },
  chevronBadge: {
    position: 'absolute',
    right: -13,
    bottom: 3,
    width: CHEVRON_BADGE_SIZE,
    height: CHEVRON_BADGE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
