import { useEffect, type ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Plus } from 'lucide-react-native';
import { useTabPageIsFocused } from '@/src/hooks/useTabPageFocus';

import { useFabBottomOffset } from '@/src/components/ui/fab-layout';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { GlassSurface } from '@/src/components/ui/glass-surface';
import { haptics } from '@/src/utils/haptics';

const FAB_SIZE = 48;
const FAB_RIGHT_OFFSET = 28;
/** Matches `channel-list-floating-actions`, so FABs layer alike over a list. */
const FAB_Z_INDEX = 1100;
/** Matches the previous `rounded-xl` on the Pressable. */
const FAB_RADIUS = 12;

const styles = StyleSheet.create({
  fabSurface: {
    width: '100%',
    height: '100%',
    borderRadius: FAB_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});

interface CallsFabProps {
  onPress: () => void;
  isHidden?: boolean;
}

export const CallsFab = ({ onPress, isHidden = false }: CallsFabProps): ReactElement | null => {
  const { accentBg, accentFg } = useBubbleAccent();
  const isFocused = useTabPageIsFocused();
  const fabBottomOffset = useFabBottomOffset();

  const fabVisibility = useSharedValue(isHidden ? 0 : 1);
  useEffect(() => {
    fabVisibility.set(
      withSpring(isHidden ? 0 : 1, {
        damping: 12,
        stiffness: 220,
        mass: 0.6,
      }),
    );
  }, [isHidden, fabVisibility]);

  const fabVisibilityStyle = useAnimatedStyle(() => ({
    transform: [{ scale: fabVisibility.get() }],
    opacity: fabVisibility.get(),
  }));

  if (!isFocused) return null;

  const handlePress = (): void => {
    void haptics.buttonTap();
    onPress();
  };

  return (
    // Sits in the tab's own tree rather than a Portal: a portal renders past
    // the navigation tree, so this floated above the workspace drawer instead
    // of sliding aside with the screen it belongs to.
    <View pointerEvents='box-none' style={[StyleSheet.absoluteFill, { zIndex: FAB_Z_INDEX }]}>
      <Animated.View
        pointerEvents={isHidden ? 'none' : 'auto'}
        style={[
          {
            position: 'absolute',
            bottom: fabBottomOffset,
            right: FAB_RIGHT_OFFSET,
            width: FAB_SIZE,
            height: FAB_SIZE,
          },
          fabVisibilityStyle,
        ]}
      >
        <Pressable onPress={handlePress} className='size-full active:opacity-90'>
          {/* Tinted rather than neutral glass: the accent is a user choice,
                so it survives the material instead of being discarded. */}
          <GlassSurface
            interactive
            fallbackColor={accentBg}
            tintColor={accentBg}
            style={styles.fabSurface}
          >
            <Plus size={24} color={accentFg} />
          </GlassSurface>
        </Pressable>
      </Animated.View>
    </View>
  );
};
