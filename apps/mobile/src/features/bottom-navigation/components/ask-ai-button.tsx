import { type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { XyneAIStarIcon } from '@/src/components/icons';

import { ACTION_BUTTON_SIZE, PILL_HEIGHT, liquidGlassTransform } from '../constants';
import { useButtonGestures } from '../hooks/use-button-gestures';
import { GlassMaterial } from './glass-material';
import { GlowOverlay } from './glow-overlay';

const HALF_W = ACTION_BUTTON_SIZE / 2;
const HALF_H = PILL_HEIGHT / 2;
const ICON_SIZE = 24;

/**
 * The round glass button beside the pill. Opens Xyne AI, with the same gradient
 * star the classic header's Ask AI button uses.
 */
export function AskAiButton({ onPress }: { onPress: () => void }): ReactElement {
  const { pressed, overflowX, overflowY, touchX, touchY, glowProgress, composedGesture } =
    useButtonGestures(onPress);

  const glassStyle = useAnimatedStyle(() =>
    liquidGlassTransform(pressed.get(), overflowX.get(), overflowY.get(), HALF_W, HALF_H),
  );

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View
        style={glassStyle}
        accessible
        accessibilityRole='button'
        accessibilityLabel='Ask AI'
        accessibilityHint='Ask anything about your workspace'
      >
        <GlassMaterial borderRadius={HALF_H} style={styles.button}>
          <View style={styles.icon}>
            <XyneAIStarIcon size={ICON_SIZE} />
          </View>
          <GlowOverlay
            size={120}
            id='askAiGlow'
            touchX={touchX}
            touchY={touchY}
            glowProgress={glowProgress}
          />
        </GlassMaterial>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  button: {
    width: ACTION_BUTTON_SIZE,
    height: PILL_HEIGHT,
  },
  icon: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
