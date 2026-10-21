import { BlurView } from 'expo-blur';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, type ViewProps } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useBottomSheet, type BottomSheetBackdropProps } from '@gorhom/bottom-sheet';

const BACKDROP_BLUR_INTENSITY = 36;
const BACKDROP_SCRIM = 'rgba(0, 0, 0, 0.28)';

export const ProfileSheetBackdrop = memo(function ProfileSheetBackdrop({
  animatedIndex,
  style,
}: BottomSheetBackdropProps) {
  const { close } = useBottomSheet();
  const isMounted = useRef(false);
  const [pointerEvents, setPointerEvents] = useState<ViewProps['pointerEvents']>('none');

  const handleClose = useCallback(() => {
    close();
  }, [close]);

  const handleTouchability = useCallback((shouldDisable: boolean) => {
    if (isMounted.current) {
      setPointerEvents(shouldDisable ? 'none' : 'auto');
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  useAnimatedReaction(
    () => animatedIndex.value <= -0.5,
    (shouldDisable, previous) => {
      if (shouldDisable === previous) return;
      runOnJS(handleTouchability)(shouldDisable);
    },
    [handleTouchability],
  );

  const containerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(animatedIndex.value, [-1, 0], [0, 1], Extrapolation.CLAMP),
  }));

  const tapGesture = useMemo(
    () =>
      Gesture.Tap().onEnd(() => {
        runOnJS(handleClose)();
      }),
    [handleClose],
  );

  return (
    <GestureDetector gesture={tapGesture}>
      <Animated.View
        accessibilityRole='button'
        accessibilityLabel='Close profile menu'
        pointerEvents={pointerEvents}
        style={[StyleSheet.absoluteFill, style, containerAnimatedStyle]}
      >
        {Platform.OS === 'ios' ? (
          <BlurView
            intensity={BACKDROP_BLUR_INTENSITY}
            tint='dark'
            style={StyleSheet.absoluteFill}
          />
        ) : null}
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            styles.scrim,
            Platform.OS === 'android' ? styles.androidScrim : null,
          ]}
        />
      </Animated.View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  scrim: {
    backgroundColor: BACKDROP_SCRIM,
  },
  androidScrim: {
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
  },
});
