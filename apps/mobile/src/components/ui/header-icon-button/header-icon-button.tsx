import { type ReactElement, type ReactNode, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassView } from 'expo-glass-effect';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useCSSVariable, useUniwind } from 'uniwind';

import { ChevronLeftIcon } from '@/src/components/icons';
import { haptics } from '@/src/utils/haptics';
import { SUPPORTS_LIQUID_GLASS } from '@/src/utils/platform';

/**
 * The circular "glass" header button used by the conversation screen. Extracted
 * so every screen reachable from a conversation shares one back button instead
 * of each header re-declaring its own copy.
 *
 * Two implementations live behind one name:
 *   - LiquidGlassIconButton — native iOS 26 UIGlassEffect, opt-in per call site.
 *   - BlurIconButton        — the expo-blur original, used everywhere else.
 * They are separate components rather than one branchy body because the
 * Reanimated hooks cannot be called conditionally.
 */
export const HEADER_ICON_BUTTON_SIZE = 44;

const PRESS_SPRING = { damping: 18, stiffness: 320, mass: 0.6 };
const PRESS_SCALE = 0.92;
const GLASS_INTENSITY = 60;

type HeaderIconButtonProps = {
  onPress: () => void;
  accessibilityLabel: string;
  children: ReactNode;
  /**
   * Opt in to the iOS 26 Liquid Glass treatment. No-ops on Android and on
   * pre-iOS-26, which always get the BlurView path.
   */
  liquidGlass?: boolean;
  /** Blocks presses and dims the control — used while an action is in flight. */
  disabled?: boolean;
  /**
   * Drops the BlurView path's press compression. Use where the press
   * dismisses the surface the button sits on: the screen slides away
   * mid-spring otherwise, and the button reads as shrinking on its way out.
   * The Liquid Glass path never compresses, so this also makes the two
   * variants behave alike. The press haptic still fires either way.
   */
  disablePressScale?: boolean;
};

type IconButtonVariantProps = Omit<HeaderIconButtonProps, 'liquidGlass'>;

/**
 * iOS 26+. UIGlassEffect draws its own shape from the flattened borderRadius
 * and renders its own specular rim, so this path deliberately carries no
 * `overflow: hidden` (a redundant CALayer mask) and no border (a hairline that
 * fights the material). `isInteractive` supplies the press lensing, which is
 * why there is no Reanimated scale here — two compressions read as broken.
 */
const LiquidGlassIconButton = ({
  onPress,
  accessibilityLabel,
  children,
  disabled = false,
}: IconButtonVariantProps): ReactElement => {
  const { theme } = useUniwind();

  const handlePressIn = useCallback(() => {
    void haptics.buttonTap();
  }, []);

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onPressIn={handlePressIn}
      disabled={disabled}
      style={styles.hitTarget}
    >
      <GlassView
        isInteractive
        glassEffectStyle='regular'
        colorScheme={theme === 'dark' ? 'dark' : 'light'}
        style={styles.glassSurface}
      >
        {children}
      </GlassView>
    </Pressable>
  );
};

const BlurIconButton = ({
  onPress,
  accessibilityLabel,
  children,
  disabled = false,
  disablePressScale = false,
}: IconButtonVariantProps): ReactElement => {
  const { theme } = useUniwind();
  const isDark = theme === 'dark';
  const blurTint: 'light' | 'dark' = isDark ? 'dark' : 'light';
  const tintOverlay = isDark ? 'rgba(20,20,22,0.35)' : 'rgba(255,255,255,0.45)';

  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  const handlePressIn = useCallback(() => {
    void haptics.buttonTap();
    if (disablePressScale) return;
    scale.set(withSpring(PRESS_SCALE, PRESS_SPRING));
  }, [disablePressScale, scale]);

  const handlePressOut = useCallback(() => {
    if (disablePressScale) return;
    scale.set(withSpring(1, PRESS_SPRING));
  }, [disablePressScale, scale]);

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        className='items-center justify-center overflow-hidden rounded-full border border-foreground/15'
        style={{ width: HEADER_ICON_BUTTON_SIZE, height: HEADER_ICON_BUTTON_SIZE }}
      >
        <BlurView
          intensity={GLASS_INTENSITY}
          tint={blurTint}
          blurMethod='dimezisBlurView'
          style={StyleSheet.absoluteFill}
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: tintOverlay }]} />
        {children}
      </Pressable>
    </Animated.View>
  );
};

/**
 * Hook-free selector. Both operands are constant for the lifetime of the
 * process (a module const and a literal at each call site), so the element
 * type never switches and nothing ever remounts.
 */
export const HeaderIconButton = ({
  liquidGlass = false,
  ...props
}: HeaderIconButtonProps): ReactElement =>
  liquidGlass && SUPPORTS_LIQUID_GLASS ? (
    <LiquidGlassIconButton {...props} />
  ) : (
    <BlurIconButton {...props} />
  );

type HeaderBackButtonProps = {
  onPress: () => void;
  accessibilityLabel?: string;
  liquidGlass?: boolean;
  /**
   * Overrides the chevron colour. Needed on surfaces that are not the app
   * background — video call screens, the attachment viewer — where
   * `--color-foreground` would be invisible.
   */
  iconColor?: string;
};

export const HeaderBackButton = ({
  onPress,
  accessibilityLabel = 'Back',
  liquidGlass = false,
  iconColor,
}: HeaderBackButtonProps): ReactElement => {
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  return (
    <HeaderIconButton
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      liquidGlass={liquidGlass}
    >
      <ChevronLeftIcon stroke={iconColor ?? foregroundColor} />
    </HeaderIconButton>
  );
};

const styles = StyleSheet.create({
  hitTarget: {
    width: HEADER_ICON_BUTTON_SIZE,
    height: HEADER_ICON_BUTTON_SIZE,
  },
  glassSurface: {
    width: HEADER_ICON_BUTTON_SIZE,
    height: HEADER_ICON_BUTTON_SIZE,
    borderRadius: HEADER_ICON_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
