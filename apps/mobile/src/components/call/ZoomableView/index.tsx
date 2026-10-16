/**
 * ZoomableView
 *
 * Pinch-zoom, pan (when zoomed) and double-tap-to-zoom wrapper for the in-call
 * screen share tile. Children are scaled with a transform, which both iOS video
 * views and Android's SurfaceView renderer honor (including the parent clip).
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { callColors } from '../callTheme';

const SPRING_CONFIG = {
  damping: 20,
  stiffness: 200,
  mass: 0.8,
};

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

interface ZoomableViewProps {
  children: React.ReactNode;
}

export function ZoomableView({ children }: ZoomableViewProps): React.ReactElement {
  const width = useSharedValue(0);
  const height = useSharedValue(0);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const [isZoomed, setIsZoomed] = useState(false);

  useAnimatedReaction(
    () => savedScale.value > MIN_SCALE + 0.05,
    (zoomed, prev) => {
      if (zoomed !== prev) scheduleOnRN(setIsZoomed, zoomed);
    },
  );

  const onLayout = (e: LayoutChangeEvent): void => {
    width.value = e.nativeEvent.layout.width;
    height.value = e.nativeEvent.layout.height;
  };

  const clampValue = (value: number, min: number, max: number): number => {
    'worklet';
    return Math.max(min, Math.min(max, value));
  };

  const clampTranslate = (value: number, size: number, currentScale: number): number => {
    'worklet';
    if (currentScale <= MIN_SCALE) return 0;
    const maxTranslate = (size * currentScale - size) / 2;
    return clampValue(value, -maxTranslate, maxTranslate);
  };

  const animateTo = (nextScale: number, nextX: number, nextY: number): void => {
    'worklet';
    scale.value = withSpring(nextScale, SPRING_CONFIG);
    translateX.value = withSpring(nextX, SPRING_CONFIG);
    translateY.value = withSpring(nextY, SPRING_CONFIG);
    savedScale.value = nextScale;
    savedTranslateX.value = nextX;
    savedTranslateY.value = nextY;
  };

  const pinchGesture = Gesture.Pinch()
    .onUpdate(event => {
      'worklet';
      const nextScale = clampValue(savedScale.value * event.scale, MIN_SCALE, MAX_SCALE);
      const scaleFactor = nextScale / scale.value;
      const focalX = event.focalX - width.value / 2;
      const focalY = event.focalY - height.value / 2;

      const nextTranslateX = focalX * (1 - scaleFactor) + translateX.value * scaleFactor;
      const nextTranslateY = focalY * (1 - scaleFactor) + translateY.value * scaleFactor;

      translateX.value = clampTranslate(nextTranslateX, width.value, nextScale);
      translateY.value = clampTranslate(nextTranslateY, height.value, nextScale);
      scale.value = nextScale;
    })
    .onEnd(() => {
      'worklet';
      if (scale.value <= MIN_SCALE + 0.001) {
        animateTo(MIN_SCALE, 0, 0);
        return;
      }
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  // Pan only activates when zoomed in, so it doesn't swallow touches at 1x
  const panGesture = Gesture.Pan()
    .manualActivation(true)
    .onTouchesMove((_event, state) => {
      'worklet';
      if (scale.value > 1.05) {
        state.activate();
      } else {
        state.fail();
      }
    })
    .onBegin(() => {
      'worklet';
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate(event => {
      'worklet';
      const nextX = savedTranslateX.value + event.translationX;
      const nextY = savedTranslateY.value + event.translationY;
      translateX.value = clampTranslate(nextX, width.value, scale.value);
      translateY.value = clampTranslate(nextY, height.value, scale.value);
    })
    .onEnd(() => {
      'worklet';
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(event => {
      'worklet';
      if (scale.value > 1.05) {
        animateTo(MIN_SCALE, 0, 0);
        return;
      }
      // Zoom in towards the tap position
      const focalX = event.x - width.value / 2;
      const focalY = event.y - height.value / 2;
      animateTo(
        DOUBLE_TAP_SCALE,
        clampTranslate(-focalX * (DOUBLE_TAP_SCALE - MIN_SCALE), width.value, DOUBLE_TAP_SCALE),
        clampTranslate(-focalY * (DOUBLE_TAP_SCALE - MIN_SCALE), height.value, DOUBLE_TAP_SCALE),
      );
    });

  const composedGesture = Gesture.Simultaneous(
    doubleTapGesture,
    Gesture.Simultaneous(pinchGesture, panGesture),
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <View style={styles.container} onLayout={onLayout}>
      <GestureDetector gesture={composedGesture}>
        <Animated.View style={[styles.content, animatedStyle]}>{children}</Animated.View>
      </GestureDetector>

      {isZoomed && (
        <Pressable
          style={styles.resetButton}
          onPress={() => animateTo(MIN_SCALE, 0, 0)}
          hitSlop={8}
          accessibilityRole='button'
          accessibilityLabel='Reset zoom'
        >
          <Text style={styles.resetButtonText}>Reset zoom</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 12,
  },
  content: {
    flex: 1,
  },
  resetButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  resetButtonText: {
    color: callColors.onColor,
    fontSize: 12,
    fontWeight: '600',
  },
});
