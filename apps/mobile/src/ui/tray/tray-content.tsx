import { useCallback, useMemo, type ReactElement, type ReactNode } from 'react';
import {
  Dimensions,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import {
  CLOSE_THRESHOLD,
  FLICK_VELOCITY,
  HEIGHT_SPRING,
  RUBBER_BAND_LIMIT,
  TRAY_BOTTOM_LIFT,
  TRAY_GRAB_HEIGHT,
  TRAY_RADIUS,
  TRAY_MAX_HEIGHT_RATIO,
  TRAY_SIDE_MARGIN,
  TRAY_SPRING,
  TRAY_Z_INDEX,
} from './constants';
import { TrayBackdrop } from './tray-backdrop';
import { useTrayInternals } from './tray-context';

const SCREEN_HEIGHT = Dimensions.get('window').height;

export type TrayContentProps = {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

/**
 * The sheet itself: auto-sized, draggable, keyboard-aware.
 *
 * Positioned absolutely against `<Tray>`'s own box rather than sent through a
 * portal. A portal re-renders its children at the host, which sits above the
 * provider in the tree — so every part inside it lost `TrayContext` and threw.
 * There was nothing to escape anyway: the tray belongs at a shell root, where
 * an absolute sibling already covers the screen.
 */
export function TrayContent({ style, children }: TrayContentProps): ReactElement | null {
  const { visible, progress, dragY, contentHeight, close } = useTrayInternals();

  /**
   * One measurement of everything inside the sheet.
   *
   * Taken here rather than per-part so the sheet can never be shorter than what
   * it draws. Whatever the active view adds — a header, a footer, the grab strip
   * above them — is inside this box and inside this number.
   */
  const onContentLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const next = event.nativeEvent.layout.height;
      if (next > 0) contentHeight.set(next);
    },
    [contentHeight],
  );
  const insets = useSafeAreaInsets();
  const surface = useCSSVariable('--color-card') as string;
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();

  // The same ceiling `useTrayBodySpace` reports to the view, so the height a
  // view sizes itself against and the height the sheet will clamp to agree.
  const maxHeight =
    SCREEN_HEIGHT * TRAY_MAX_HEIGHT_RATIO - insets.top - insets.bottom - TRAY_BOTTOM_LIFT;

  /**
   * Armed on the header strip only — never the whole sheet.
   *
   * A sheet-wide pan fights a scrollable body and, in Customize, the row drag.
   * Restricting it to the header is what lets all three coexist.
   */
  const dragGesture = useMemo(
    () =>
      Gesture.Pan()
        .onUpdate(event => {
          const dy = event.translationY;
          // Downward travels 1:1; upward meets rubber-band resistance so the
          // sheet cannot be pulled off its anchor.
          dragY.set(dy >= 0 ? dy : -RUBBER_BAND_LIMIT * (1 - 1 / (-dy / RUBBER_BAND_LIMIT + 1)));
        })
        .onEnd(event => {
          if (dragY.get() > CLOSE_THRESHOLD || event.velocityY > FLICK_VELOCITY) {
            scheduleOnRN(close);
            return;
          }
          dragY.set(withSpring(0, TRAY_SPRING));
        })
        // Runs however the touch ends, so a cancelled drag can never strand the
        // sheet off-centre.
        .onFinalize(() => {
          dragY.set(withSpring(0, TRAY_SPRING));
        }),
    [close, dragY],
  );

  const sheetStyle = useAnimatedStyle(() => {
    const open = progress.get();
    const body = contentHeight.get();
    const target = Math.min(body, maxHeight);

    return {
      height: body === 0 ? undefined : withSpring(target, HEIGHT_SPRING),
      opacity: open,
      transform: [
        // Closed, the sheet sits one full height below its resting place; the
        // keyboard lifts it and the drag offsets it, all in the same transform.
        { translateY: (1 - open) * (target + insets.bottom) + dragY.get() + keyboardHeight.get() },
        { scale: 0.94 + open * 0.06 },
      ],
    };
  });

  if (!visible) return null;

  return (
    <Animated.View pointerEvents='box-none' style={styles.root}>
      <TrayBackdrop />
      <Animated.View
        accessibilityViewIsModal
        style={[
          styles.sheet,
          {
            backgroundColor: surface,
            marginBottom: insets.bottom + TRAY_BOTTOM_LIFT,
            maxHeight,
          },
          sheetStyle,
          style,
        ]}
      >
        <View onLayout={onContentLayout}>
          <GestureDetector gesture={dragGesture}>
            <Animated.View style={styles.grabArea}>
              <Animated.View style={styles.grabber} />
            </Animated.View>
          </GestureDetector>
          {children}
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
    zIndex: TRAY_Z_INDEX,
    elevation: TRAY_Z_INDEX,
  },
  sheet: {
    marginHorizontal: TRAY_SIDE_MARGIN,
    borderRadius: TRAY_RADIUS,
    overflow: 'hidden',
  },
  grabArea: {
    height: TRAY_GRAB_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(128, 128, 128, 0.35)',
  },
});
