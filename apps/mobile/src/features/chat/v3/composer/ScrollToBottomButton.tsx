import { type ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { GlassView } from 'expo-glass-effect';
import { ChevronDown } from 'lucide-react-native';
import { useCSSVariable, useUniwind } from 'uniwind';

import { SUPPORTS_LIQUID_GLASS } from '@/src/utils/platform';
import { haptics } from '@/src/utils/haptics';

const BUTTON_SIZE = 32;

const styles = StyleSheet.create({
  glass: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: BUTTON_SIZE / 2,
  },
});

export function ScrollToBottomButton({
  visible,
  bottomOffset,
  onPress,
}: {
  visible: boolean;
  bottomOffset: number;
  onPress: () => void;
}): ReactElement | null {
  const foregroundColor = useCSSVariable('--color-foreground') as string;
  const { theme } = useUniwind();

  if (!visible) return null;

  return (
    <View
      pointerEvents='box-none'
      style={{
        position: 'absolute',
        right: 16,
        bottom: bottomOffset,
        zIndex: 40,
        width: BUTTON_SIZE,
        height: BUTTON_SIZE,
      }}
    >
      <Pressable
        onPress={onPress}
        onPressIn={(): void => {
          void haptics.buttonTap();
        }}
        accessibilityRole='button'
        accessibilityLabel='Scroll to bottom'
        className={
          SUPPORTS_LIQUID_GLASS
            ? 'flex-1 items-center justify-center rounded-full'
            : 'flex-1 items-center justify-center rounded-full bg-muted'
        }
      >
        {SUPPORTS_LIQUID_GLASS ? (
          <GlassView
            glassEffectStyle='regular'
            colorScheme={theme === 'dark' ? 'dark' : 'light'}
            style={styles.glass}
          />
        ) : null}
        <ChevronDown size={16} color={foregroundColor} />
      </Pressable>
    </View>
  );
}
