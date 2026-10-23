import { RefreshCw } from 'lucide-react-native';
import { useEffect, type ReactElement } from 'react';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

/** The glyph a live-sync indicator spins while connecting. */
export function ConnectingSpinner({
  color,
  size = 12,
}: {
  color: string;
  size?: number;
}): ReactElement {
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.set(withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1, false));
    return (): void => cancelAnimation(rotation);
  }, [rotation]);

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.get()}deg` }] }));

  return (
    <Animated.View style={style}>
      <RefreshCw size={size} color={color} strokeWidth={2.5} />
    </Animated.View>
  );
}
