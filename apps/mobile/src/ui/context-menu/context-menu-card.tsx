import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { BackHandler, Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OVERLAY_BORDER_WIDTH, useOverlayBorderColor } from '@/src/ui/overlay-border';
import { Portal } from '@/src/components/primitives/portal';
import { TAB_OVERLAY_PORTAL_HOST } from '@/src/components/tab-pager/tab-overlay-portal';
import { Z_INDEX } from '@/src/ui/z-index';

import {
  MENU_CLOSE_MS,
  MENU_CORNER_RADIUS,
  MENU_LABEL_HEIGHT,
  MENU_LABEL_TEXT_SIZE,
  MENU_OPEN_BASE_MS,
  MENU_OPEN_PER_ITEM_MS,
} from './constants';
import { ContextMenuProvider, useContextMenuState } from './context';
import { clampMenuWidth, placeMenu, type MenuSize } from './placement';

export type ContextMenuCardProps = {
  /** The small row above the items — the conversation's name, in the design. */
  label?: string;
  /** How many items, so the unfurl is timed */
  itemCount: number;
  children: ReactNode;
};

/**
 * The card, its backdrop, and where both go.
 *
 * Rendered through the shell's overlay portal rather than a `Modal`. A
 * `Modal` brings its own window, its own dismissal lifecycle and its own
 * full-screen touch target that outlives the close — all of which have to be
 * got exactly right before the menu simply works. The portal is already how
 * this app puts things over the bar, and it has none of that.
 *
 * It mounts only while open, so a list of a hundred rows holding a hundred
 * `Root`s costs a hundred `useState`s and nothing else.
 */
export function ContextMenuCard({
  label,
  itemCount,
  children,
}: ContextMenuCardProps): ReactElement {
  const menu = useContextMenuState('ContextMenu.Content');
  const { anchor, close } = menu;
  const insets = useSafeAreaInsets();
  const borderColor = useOverlayBorderColor();

  // Measured on the first layout, then placed. Until then the card is laid
  // out off-screen so it can size itself without being seen doing it.
  const [size, setSize] = useState<MenuSize | null>(null);

  const progress = useSharedValue(0);

  useEffect(() => {
    if (size === null) return;
    progress.set(
      withTiming(1, {
        duration: MENU_OPEN_BASE_MS + MENU_OPEN_PER_ITEM_MS * itemCount,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [itemCount, progress, size]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return (): void => subscription.remove();
  }, [close]);

  const placement = useMemo(() => {
    if (anchor === null || size === null) return null;
    const window = Dimensions.get('window');
    return placeMenu(anchor, size, {
      width: window.width,
      height: window.height,
      insetTop: insets.top,
      insetBottom: insets.bottom,
    });
  }, [anchor, insets.bottom, insets.top, size]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ scaleY: 0.6 + progress.get() * 0.4 }],
  }));

  /*
   * The context is re-provided on the far side of the portal.
   *
   * This portal is not React's own — it stores children and `PortalHost`
   * renders them, so they resolve context from the host's position in the
   * tree, not from here. Without this, an `Item` looks for a `Root` beside
   * the tab navigator and throws. The value is the same object, so nothing
   * re-renders that would not have anyway.
   */
  return (
    <Portal name='context-menu' hostName={TAB_OVERLAY_PORTAL_HOST}>
      <ContextMenuProvider value={menu}>
        <View style={styles.layer}>
          {/*
            `absoluteFill` on the wrapper too, not just the child.
            Without it the wrapper has no style, lays out at 0x0, and the
            child's absolute inset of 0 resolves against nothing — so the
            backdrop covers the screen visually but catches no touches, and
            the list underneath keeps scrolling with the menu open.
          */}
          <Animated.View
            style={StyleSheet.absoluteFill}
            entering={FadeIn.duration(120)}
            exiting={FadeOut.duration(MENU_CLOSE_MS)}
          >
            <Pressable
              accessibilityLabel='Dismiss menu'
              style={StyleSheet.absoluteFill}
              onPress={close}
            />
          </Animated.View>

          <Animated.View
            onLayout={event => {
              if (size !== null) return;
              const { width, height } = event.nativeEvent.layout;
              setSize({ width: clampMenuWidth(width), height });
            }}
            style={[
              styles.card,
              cardStyle,
              placement === null
                ? // Laid out but not shown, so it can measure itself first.
                  { opacity: 0, top: 0, left: 0 }
                : {
                    left: placement.left,
                    top: placement.top,
                    transformOrigin: `${placement.originX}px ${placement.origin}`,
                  },
              size !== null ? { width: size.width } : null,
              { borderColor },
            ]}
            className='bg-spaces-background'
          >
            {label !== undefined ? (
              <Text numberOfLines={1} style={styles.label} className='text-spaces-muted'>
                {label}
              </Text>
            ) : null}
            {children}
          </Animated.View>
        </View>
      </ContextMenuProvider>
    </Portal>
  );
}

const styles = StyleSheet.create({
  /*
   * The tab bar declares a `zIndex`, which makes every sibling without one
   * count as 0 — so an unstated layer here paints under the bar and the bar
   * keeps taking taps while a menu is open.
   */
  layer: {
    ...StyleSheet.absoluteFill,
    zIndex: Z_INDEX.overlay,
    elevation: Z_INDEX.overlay,
  },
  card: {
    position: 'absolute',
    borderRadius: MENU_CORNER_RADIUS,
    overflow: 'hidden',
    paddingVertical: 6,
    boxShadow: '0px 8px 24px 0px rgba(18, 20, 28, 0.16), 0px 2px 6px 0px rgba(18, 20, 28, 0.08)',
    borderCurve: 'continuous',
    borderWidth: OVERLAY_BORDER_WIDTH,
  },
  label: {
    height: MENU_LABEL_HEIGHT,
    lineHeight: MENU_LABEL_HEIGHT,
    paddingHorizontal: 18,
    fontSize: MENU_LABEL_TEXT_SIZE,
  },
});
