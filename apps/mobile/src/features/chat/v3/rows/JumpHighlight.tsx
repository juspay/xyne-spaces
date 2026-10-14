import { useEffect, type ReactElement, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useUniwind } from 'uniwind';

const HIGHLIGHT_DURATION_MS = 3500;
const LIGHT_PEAK = 1;
const DARK_PEAK = 0.4;

type JumpHighlightProps = {
  conversationId: string;
  enabled: boolean;
  children: ReactNode;
};

/**
 * Recycle-safe jump highlight. `conversationId` is in the effect deps so a
 * recycled row that is also highlighted restarts the fade instead of keeping
 * the previous item's spent overlay. Overlay only — does not change height.
 */
export function JumpHighlight({
  conversationId,
  enabled,
  children,
}: JumpHighlightProps): ReactElement {
  const { theme } = useUniwind();
  const isDark = theme === 'dark';
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!enabled) {
      cancelAnimation(opacity);
      opacity.value = 0;
      return;
    }
    const peak = isDark ? DARK_PEAK : LIGHT_PEAK;
    opacity.value = withSequence(
      withTiming(peak, { duration: 0 }),
      withTiming(0, { duration: HIGHLIGHT_DURATION_MS }),
    );
    return (): void => {
      cancelAnimation(opacity);
    };
  }, [conversationId, enabled, isDark, opacity]);

  const highlightOverlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View style={{ position: 'relative' }}>
      <Animated.View
        pointerEvents='none'
        style={[
          {
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: isDark ? 'rgb(120, 80, 20)' : 'rgb(253, 244, 221)',
          },
          highlightOverlayStyle,
        ]}
      />
      {children}
    </View>
  );
}
