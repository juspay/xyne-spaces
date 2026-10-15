/**
 * ImageViewerPage Component for Lotus
 *
 * Single image with pinch-zoom, pan, and double-tap to zoom.
 * Uses react-native-gesture-handler + react-native-reanimated.
 */

import { memo } from 'react';
import { StyleSheet, View, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useMtlsImage } from '@/src/hooks/useMtlsImage';
import type { MessageAttachment } from '../message-attachments.utils';

const SPRING_CONFIG = {
  damping: 20,
  stiffness: 200,
  mass: 0.8,
};

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

interface ImageViewerPageProps {
  attachment: MessageAttachment;
  onSwipeDown?: () => void;
}

export const ImageViewerPage = memo(function ImageViewerPage({
  attachment,
  onSwipeDown: _,
}: ImageViewerPageProps) {
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

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

  // Use mTLS authenticated image loading
  const { uri, isLoading } = useMtlsImage(attachment.id);

  // Pinch gesture for zoom
  const pinchGesture = Gesture.Pinch()
    .onUpdate(event => {
      'worklet';
      const nextScale = clampValue(savedScale.value * event.scale, MIN_SCALE, MAX_SCALE);
      const scaleFactor = nextScale / scale.value;
      const focalX = event.focalX - viewportWidth / 2;
      const focalY = event.focalY - viewportHeight / 2;

      const nextTranslateX = focalX * (1 - scaleFactor) + translateX.value * scaleFactor;
      const nextTranslateY = focalY * (1 - scaleFactor) + translateY.value * scaleFactor;

      translateX.value = clampTranslate(nextTranslateX, viewportWidth, nextScale);
      translateY.value = clampTranslate(nextTranslateY, viewportHeight, nextScale);
      scale.value = nextScale;
    })
    .onEnd(() => {
      'worklet';
      if (scale.value <= MIN_SCALE + 0.001) {
        scale.value = withSpring(MIN_SCALE, SPRING_CONFIG);
        savedScale.value = MIN_SCALE;
        translateX.value = withSpring(0, SPRING_CONFIG);
        translateY.value = withSpring(0, SPRING_CONFIG);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        return;
      }

      const clampedX = clampTranslate(translateX.value, viewportWidth, scale.value);
      const clampedY = clampTranslate(translateY.value, viewportHeight, scale.value);
      translateX.value = withSpring(clampedX, SPRING_CONFIG);
      translateY.value = withSpring(clampedY, SPRING_CONFIG);
      savedTranslateX.value = clampedX;
      savedTranslateY.value = clampedY;
      savedScale.value = scale.value;
    });

  // Pan gesture - only activates when zoomed in, so carousel swipes pass through at scale=1
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
      translateX.value = clampTranslate(nextX, viewportWidth, scale.value);
      translateY.value = clampTranslate(nextY, viewportHeight, scale.value);
    })
    .onEnd(() => {
      'worklet';
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  // Double tap to zoom toggle
  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(event => {
      'worklet';
      if (scale.value > 1.05) {
        // Zoom out
        scale.value = withSpring(MIN_SCALE, SPRING_CONFIG);
        savedScale.value = MIN_SCALE;
        translateX.value = withSpring(0, SPRING_CONFIG);
        translateY.value = withSpring(0, SPRING_CONFIG);
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        // Zoom in towards tap position
        const focalX = event.x - viewportWidth / 2;
        const focalY = event.y - viewportHeight / 2;
        const targetTranslateX = clampTranslate(
          -focalX * (DOUBLE_TAP_SCALE - MIN_SCALE),
          viewportWidth,
          DOUBLE_TAP_SCALE,
        );
        const targetTranslateY = clampTranslate(
          -focalY * (DOUBLE_TAP_SCALE - MIN_SCALE),
          viewportHeight,
          DOUBLE_TAP_SCALE,
        );

        scale.value = withSpring(DOUBLE_TAP_SCALE, SPRING_CONFIG);
        savedScale.value = DOUBLE_TAP_SCALE;
        translateX.value = withSpring(targetTranslateX, SPRING_CONFIG);
        translateY.value = withSpring(targetTranslateY, SPRING_CONFIG);
        savedTranslateX.value = targetTranslateX;
        savedTranslateY.value = targetTranslateY;
      }
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
    <GestureDetector gesture={composedGesture}>
      <Animated.View
        style={[styles.container, animatedStyle]}
        renderToHardwareTextureAndroid
        shouldRasterizeIOS
      >
        {uri && (
          <Image
            source={{ uri }}
            style={styles.image}
            contentFit='contain'
            transition={150}
            cachePolicy='memory-disk'
            recyclingKey={attachment.id}
          />
        )}
        {isLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size='large' color='white' />
          </View>
        )}
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
});
