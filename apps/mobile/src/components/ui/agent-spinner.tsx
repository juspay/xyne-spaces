import { memo, useEffect, type ReactElement } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

/**
 * Single agent loader — same three-dot bounce used for chat typing indicators.
 */

type AgentSpinnerProps = {
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
};

const DOT_COUNT = 3;
const CYCLE_MS = 420;
const DOT_GAP = 3;

function TypingDot({
  color,
  diameter,
  delayMs,
}: {
  color: string;
  diameter: number;
  delayMs: number;
}): ReactElement {
  const opacity = useSharedValue(0.35);

  useEffect(() => {
    opacity.value = withDelay(
      delayMs,
      withRepeat(
        withSequence(
          withTiming(1, { duration: CYCLE_MS, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.35, { duration: CYCLE_MS, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      ),
    );
    return (): void => {
      cancelAnimation(opacity);
    };
  }, [delayMs, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          backgroundColor: color,
        },
        animatedStyle,
      ]}
    />
  );
}

const AgentSpinnerComponent = ({
  size = 12,
  color = '#8E8E93',
  style,
}: AgentSpinnerProps): ReactElement => {
  const diameter = Math.max(3, Math.round(size * 0.35));

  return (
    <View
      accessibilityLabel='loading'
      accessibilityLiveRegion='polite'
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: DOT_GAP,
          height: size,
        },
        style,
      ]}
    >
      {Array.from({ length: DOT_COUNT }, (_, index) => (
        <TypingDot
          key={index}
          color={color}
          diameter={diameter}
          delayMs={index * Math.round(CYCLE_MS / 2)}
        />
      ))}
    </View>
  );
};

const AgentSpinner = memo(AgentSpinnerComponent);
AgentSpinner.displayName = 'AgentSpinner';

export { AgentSpinner };
