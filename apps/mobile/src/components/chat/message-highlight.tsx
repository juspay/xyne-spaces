import { ReactElement, ReactNode, useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useUniwind } from 'uniwind';

const HIGHLIGHT_DURATION_MS = 3500;
const LIGHT_PEAK = 1;
const DARK_PEAK = 0.4;

type MessageHighlightProps = {
  enabled: boolean;
  children: ReactNode;
};

export const MessageHighlight = ({ enabled, children }: MessageHighlightProps): ReactElement => {
  const { theme } = useUniwind();
  const isDark = theme === 'dark';
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (!enabled) {
      opacity.value = 0;
      return;
    }
    opacity.value = isDark ? DARK_PEAK : LIGHT_PEAK;
    opacity.value = withTiming(0, { duration: HIGHLIGHT_DURATION_MS });
  }, [enabled, isDark, opacity]);

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
};
