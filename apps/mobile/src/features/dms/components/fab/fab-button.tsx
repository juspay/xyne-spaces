import { type ReactElement } from 'react';
import { Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Plus } from 'lucide-react-native';

import {
  ICON_SIZE,
  SEARCH_BAR_RADIUS,
  SEARCH_BUTTON_SIZE,
  TAB_BAR_HORIZONTAL_PADDING,
} from '@/src/features/bottom-navigation/constants';
import { useSpacesTabBarHeight } from '@/src/features/bottom-navigation';
import { haptics } from '@/src/utils/haptics';

import { DMS_FAB_GAP } from '../../constants';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Sized and placed to line up with the bar's search button: same square, same
 * corner radius, same inset from the right edge, so the two share a vertical
 * centre line. Nothing lays them out together — the alignment holds because
 * both read the same constants.
 *
 * Unlike grok's trigger, this one does not scale away when the menu opens.
 * The design keeps it in place and turns the plus into a close, so it stays
 * the thing that dismisses what it opened.
 */
export function FabButton({ isOpen }: { isOpen: SharedValue<boolean> }): ReactElement {
  const barHeight = useSpacesTabBarHeight();

  const iconStyle = useAnimatedStyle(() => ({
    transform: [
      {
        rotate: isOpen.get()
          ? withTiming('45deg')
          : withSpring('0deg', { damping: 70, stiffness: 1600 }),
      },
    ],
  }));

  return (
    <AnimatedPressable
      accessibilityRole='button'
      accessibilityLabel='New'
      onPress={() => {
        void haptics.buttonTap();
        isOpen.set(!isOpen.get());
      }}
      className='absolute items-center justify-center bg-spaces-accent'
      style={{
        width: SEARCH_BUTTON_SIZE,
        height: SEARCH_BUTTON_SIZE,
        borderRadius: SEARCH_BAR_RADIUS,
        bottom: barHeight + DMS_FAB_GAP,
        right: TAB_BAR_HORIZONTAL_PADDING,
      }}
    >
      <Animated.View style={iconStyle}>
        <Plus size={ICON_SIZE} color='#FFFFFF' strokeWidth={2} />
      </Animated.View>
    </AnimatedPressable>
  );
}
