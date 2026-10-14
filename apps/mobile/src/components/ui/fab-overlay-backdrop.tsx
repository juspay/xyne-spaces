import { BlurView } from 'expo-blur';
import { memo, type ReactElement } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

/**
 * The backdrop behind a floating action button's long-press overlay, shared by
 * the channels and DMs tabs so both read as the same surface.
 *
 * It is deliberately dark in *both* themes. The overlays that sit on it — the
 * starred channels stack, the DM contact fan — label themselves in white, and
 * a surface that flips with the theme would flip their contrast with it. This
 * is the same call iOS makes for its own long-press menus: the app dims behind
 * the menu whatever the appearance. So the work is split — the blur separates
 * the overlay from the list, and the tint only takes the contrast down far
 * enough for white to read, leaving the list visible rather than blacked out.
 *
 * The two backends are not interchangeable, so matching them takes different
 * numbers. `blurMethod='dimezisBlurView'` is what makes the blur real on
 * Android — without it `BlurView` degrades to a flat tint — but it blurs
 * without darkening much, so there the scrim carries the contrast. iOS ignores
 * that prop and renders a real `UIBlurEffect`, where a dark tint is nearly
 * opaque on its own; stacking the same scrim on top is what buried the list
 * behind a black sheet. Tuned so both land in the same place.
 */
const BLUR_INTENSITY = Platform.OS === 'ios' ? 40 : 85;
const TINT_COLOR = Platform.OS === 'ios' ? 'rgba(0, 0, 0, 0.18)' : 'rgba(0, 0, 0, 0.3)';

type FabOverlayBackdropProps = {
  /** 0 → 1 open progress of the overlay this sits behind. */
  progress: SharedValue<number>;
  onDismiss: () => void;
  accessibilityLabel: string;
};

function FabOverlayBackdropComponent({
  progress,
  onDismiss,
  accessibilityLabel,
}: FabOverlayBackdropProps): ReactElement {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.45], [0, 1], Extrapolation.CLAMP),
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]}>
      <BlurView
        intensity={BLUR_INTENSITY}
        tint='dark'
        blurMethod='dimezisBlurView'
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents='none'
        style={[StyleSheet.absoluteFill, { backgroundColor: TINT_COLOR }]}
      />
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={accessibilityLabel}
        onPress={onDismiss}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

export const FabOverlayBackdrop = memo(FabOverlayBackdropComponent);
