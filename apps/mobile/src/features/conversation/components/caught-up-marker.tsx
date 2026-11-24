import { memo, type ReactElement } from 'react';
import { Text } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { CAUGHT_UP_GAP } from '../constants';

type CaughtUpMarkerProps = {
  visible: SharedValue<boolean>;
  /** The typing bar's live height; the caption sits just above it. */
  composerHeight: SharedValue<number>;
};

/**
 * Figma "You're all caught up": shown while the user drags past the newest
 * message and there is nothing newer, gone on release. Rides in the composer
 * dock, so it follows the bar and the keyboard.
 */
export const CaughtUpMarker = memo(function CaughtUpMarker({
  visible,
  composerHeight,
}: CaughtUpMarkerProps): ReactElement {
  const style = useAnimatedStyle(
    () => ({
      display: visible.get() ? 'flex' : 'none',
      bottom: composerHeight.get() + CAUGHT_UP_GAP,
    }),
    [composerHeight, visible],
  );

  return (
    <Animated.View
      pointerEvents='none'
      className='absolute left-0 right-0 items-center'
      style={style}
    >
      <Text className='text-[12px] leading-4 text-spaces-muted'>{'🎉  You’re all caught up'}</Text>
    </Animated.View>
  );
});
