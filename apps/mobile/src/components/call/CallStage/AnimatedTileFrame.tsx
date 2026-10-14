import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { callMotion } from '../callTheme';
import {
  getPipRect,
  nearestPipCorner,
  type PipCorner,
  type Size,
  type StageInsets,
  type TileFrame,
} from '../callStage.utils';

interface PipDragConfig {
  stage: Size;
  insets: StageInsets;
  onCornerChange: (corner: PipCorner) => void;
}

interface AnimatedTileFrameProps {
  frame: TileFrame;
  /** When set the tile can be dragged and snaps to the nearest corner on release. */
  drag?: PipDragConfig | undefined;
  children: React.ReactNode;
}

const FRAME_TIMING = { duration: callMotion.layoutMs, easing: Easing.out(Easing.cubic) };

/**
 * Positions a tile absolutely and animates its frame whenever the stage layout changes — a
 * third person joining glides the PiP into the grid instead of popping. Video views only ever
 * see a size/position change (never a transform), which native video surfaces handle cleanly.
 */
export function AnimatedTileFrame({
  frame,
  drag,
  children,
}: AnimatedTileFrameProps): React.ReactElement {
  const x = useSharedValue(frame.x);
  const y = useSharedValue(frame.y);
  const w = useSharedValue(frame.width);
  const h = useSharedValue(frame.height);
  const r = useSharedValue(frame.radius);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const dragStartX = useSharedValue(0);
  const dragStartY = useSharedValue(0);

  useEffect(() => {
    x.value = withTiming(frame.x, FRAME_TIMING);
    y.value = withTiming(frame.y, FRAME_TIMING);
    w.value = withTiming(frame.width, FRAME_TIMING);
    h.value = withTiming(frame.height, FRAME_TIMING);
    r.value = withTiming(frame.radius, FRAME_TIMING);
  }, [frame.x, frame.y, frame.width, frame.height, frame.radius, x, y, w, h, r]);

  const outerStyle = useAnimatedStyle(() => ({
    left: x.value + dragX.value,
    top: y.value + dragY.value,
    width: w.value,
    height: h.value,
    borderRadius: r.value,
  }));
  const innerStyle = useAnimatedStyle(() => ({ borderRadius: r.value }));

  const pan = Gesture.Pan()
    .enabled(!!drag)
    .minDistance(6)
    .onStart(() => {
      dragStartX.value = dragX.value;
      dragStartY.value = dragY.value;
    })
    .onUpdate(event => {
      dragX.value = dragStartX.value + event.translationX;
      dragY.value = dragStartY.value + event.translationY;
    })
    .onEnd(event => {
      if (!drag) return;
      const centerX = x.value + dragX.value + w.value / 2;
      const centerY = y.value + dragY.value + h.value / 2;
      const corner = nearestPipCorner(
        centerX,
        centerY,
        event.velocityX,
        event.velocityY,
        drag.stage,
        drag.insets,
      );
      const target = getPipRect(corner, drag.stage, drag.insets);
      // Glide to the corner; base position and drag offset trade places so the path stays continuous.
      x.value = withTiming(target.x, FRAME_TIMING);
      y.value = withTiming(target.y, FRAME_TIMING);
      dragX.value = withTiming(0, FRAME_TIMING);
      dragY.value = withTiming(0, FRAME_TIMING);
      scheduleOnRN(drag.onCornerChange, corner);
    });

  const isPip = !!drag;
  const body = (
    <Animated.View
      entering={FadeIn.duration(callMotion.fadeMs + 40)}
      exiting={FadeOut.duration(callMotion.fadeMs)}
      style={[styles.outer, { zIndex: frame.zIndex }, isPip && styles.pipShadow, outerStyle]}
    >
      <Animated.View style={[styles.inner, innerStyle]}>{children}</Animated.View>
      {isPip ? <View pointerEvents='none' style={styles.pipBorder} /> : null}
    </Animated.View>
  );

  // Always wrap (disabled when not a PiP) so a tile changing role never changes its tree shape —
  // that would remount it, restarting the glide and its native video view.
  return <GestureDetector gesture={pan}>{body}</GestureDetector>;
}

const styles = StyleSheet.create({
  outer: {
    position: 'absolute',
  },
  inner: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  pipShadow: {
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  pipBorder: {
    ...StyleSheet.absoluteFill,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(255,255,255,0.28)',
  },
});
