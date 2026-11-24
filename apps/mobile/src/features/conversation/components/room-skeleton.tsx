import { memo, useEffect, type ReactElement } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import {
  MESSAGE_AVATAR_SIZE,
  MESSAGE_BODY_LINE_HEIGHT,
  MESSAGE_GAP,
  MESSAGE_PADDING_Y,
  ROOM_SKELETON_BAR_HEIGHT,
  ROOM_SKELETON_NAME_WIDTH,
  ROOM_SKELETON_PULSE_MS,
  ROOM_SKELETON_PULSE_OPACITY,
} from '../constants';

/** Body line widths for each placeholder row, as shares of the body. */
const ROWS: readonly (readonly `${number}%`[])[] = [['92%', '64%'], ['78%'], ['86%', '40%']];

const ROW_STYLE = { paddingVertical: MESSAGE_PADDING_Y, columnGap: MESSAGE_GAP } as const;
const AVATAR_STYLE = {
  width: MESSAGE_AVATAR_SIZE,
  height: MESSAGE_AVATAR_SIZE,
  borderRadius: MESSAGE_AVATAR_SIZE / 2,
} as const;
const BAR_STYLE = {
  height: ROOM_SKELETON_BAR_HEIGHT,
  borderRadius: ROOM_SKELETON_BAR_HEIGHT / 2,
} as const;
const NAME_BAR_STYLE = { ...BAR_STYLE, width: ROOM_SKELETON_NAME_WIDTH } as const;
/** Each bar is centred on a body line, so the placeholder keeps the rows' own rhythm. */
const LINE_STYLE = { height: MESSAGE_BODY_LINE_HEIGHT, justifyContent: 'center' } as const;

/**
 * The room's first-load placeholder: flat message rows (a face, a name and a
 * line or two of words) in the surface colour, pulsing unless motion is
 * reduced. The list's overlay already insets it by the rows' 16.
 */
export const RoomSkeleton = memo(function RoomSkeleton(): ReactElement {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) return;
    pulse.set(
      withRepeat(
        withTiming(ROOM_SKELETON_PULSE_OPACITY, {
          duration: ROOM_SKELETON_PULSE_MS,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true,
      ),
    );
    return (): void => cancelAnimation(pulse);
  }, [pulse, reduceMotion]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.get() }), [pulse]);

  return (
    <Animated.View style={style} accessibilityLabel='Loading messages'>
      {ROWS.map((lines, row) => (
        <View key={row} className='flex-row' style={ROW_STYLE}>
          <View className='bg-spaces-surface' style={AVATAR_STYLE} />
          <View className='min-w-0 flex-1'>
            <View style={LINE_STYLE}>
              <View className='bg-spaces-surface' style={NAME_BAR_STYLE} />
            </View>
            {lines.map((width, line) => (
              <View key={line} style={LINE_STYLE}>
                <View className='bg-spaces-surface' style={[BAR_STYLE, { width }]} />
              </View>
            ))}
          </View>
        </View>
      ))}
    </Animated.View>
  );
});
