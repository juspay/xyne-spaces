import { useCallback, type ReactElement, type ReactNode } from 'react';
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useUniwind } from 'uniwind';

type ListRowPressableProps = Omit<PressableProps, 'android_ripple' | 'style'> & {
  backgroundColor?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
  pressedBackgroundColor?: string | undefined;
  rippleColor?: string | undefined;
  style?: StyleProp<ViewStyle> | ((state: PressableStateCallbackType) => StyleProp<ViewStyle>);
};

const DARK_RIPPLE = 'rgba(255, 255, 255, 0.1)';
const LIGHT_RIPPLE = 'rgba(0, 0, 0, 0.12)';
const DARK_PRESSED_BG = 'rgba(255, 255, 255, 0.12)';
const LIGHT_PRESSED_BG = 'rgba(0, 0, 0, 0.10)';

export function ListRowPressable({
  backgroundColor,
  children,
  onPressIn,
  pressedBackgroundColor,
  rippleColor,
  style,
  ...props
}: ListRowPressableProps): ReactElement {
  const { theme } = useUniwind();
  const resolvedRippleColor = rippleColor ?? (theme === 'dark' ? DARK_RIPPLE : LIGHT_RIPPLE);
  const resolvedPressedBg =
    pressedBackgroundColor ?? (theme === 'dark' ? DARK_PRESSED_BG : LIGHT_PRESSED_BG);

  /**
   * Every row tap buzzes from here, so consumers must not fire their own tap
   * haptic on top — one action, one haptic. Outcome haptics (success/error)
   * still belong at the call site.
   */
  const handlePressIn = useCallback(
    (event: GestureResponderEvent): void => {
      onPressIn?.(event);
    },
    [onPressIn],
  );

  return (
    <Pressable
      accessibilityRole='button'
      android_ripple={{ color: resolvedRippleColor, foreground: true }}
      onPressIn={handlePressIn}
      style={(state): StyleProp<ViewStyle> => [
        backgroundColor ? { backgroundColor } : null,
        typeof style === 'function' ? style(state) : style,
        state.pressed ? { backgroundColor: resolvedPressedBg } : null,
      ]}
      {...props}
    >
      {children}
    </Pressable>
  );
}
