import { useEffect, type ReactElement } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { avatarRadius } from '@/src/ui/avatar/avatar.geometry';

import {
  DM_AVATAR_GAP,
  DM_AVATAR_SIZE,
  DM_META_TOP,
  DM_PREVIEW_GAP,
  DM_PREVIEW_LINE_HEIGHT,
  DM_ROW_HEIGHT,
  DM_ROW_PADDING_LEFT,
  DM_ROW_PADDING_RIGHT,
  DM_TEXT_TOP,
  DM_TIMESTAMP_LINE_HEIGHT,
  DM_TITLE_LINE_HEIGHT,
} from '../constants';

const TITLE_BAR_HEIGHT = 12;
const PREVIEW_BAR_HEIGHT = 10;
const TIMESTAMP_BAR_HEIGHT = 8;
const TIMESTAMP_BAR_WIDTH = 32;

/**
 * Title and preview widths, cycled down the list so the placeholder reads as
 * a column of different conversations rather than one row repeated.
 */
const BAR_WIDTHS: readonly (readonly [title: `${number}%`, preview: `${number}%`])[] = [
  ['45%', '80%'],
  ['60%', '65%'],
  ['35%', '90%'],
  ['52%', '72%'],
];

/**
 * One placeholder row, laid out on the metrics `DmsList` places a real row
 * with: each bar sits centred in the line box of the text it stands in for.
 */
function DmRowSkeleton({ index }: { index: number }): ReactElement {
  const [titleWidth, previewWidth] = BAR_WIDTHS[index % BAR_WIDTHS.length] ?? BAR_WIDTHS[0]!;

  return (
    <View
      className='flex-row'
      style={{
        height: DM_ROW_HEIGHT,
        paddingLeft: DM_ROW_PADDING_LEFT,
        paddingRight: DM_ROW_PADDING_RIGHT,
      }}
    >
      <View style={{ paddingTop: (DM_ROW_HEIGHT - DM_AVATAR_SIZE) / 2 }}>
        <View
          className='bg-spaces-foreground/10'
          style={{
            width: DM_AVATAR_SIZE,
            height: DM_AVATAR_SIZE,
            borderRadius: avatarRadius(DM_AVATAR_SIZE),
          }}
        />
      </View>

      <View
        className='flex-1 min-w-0'
        style={{ marginLeft: DM_AVATAR_GAP, paddingTop: DM_TEXT_TOP }}
      >
        <View
          className='rounded-md bg-spaces-foreground/10'
          style={{
            width: titleWidth,
            height: TITLE_BAR_HEIGHT,
            marginTop: (DM_TITLE_LINE_HEIGHT - TITLE_BAR_HEIGHT) / 2,
          }}
        />
        <View
          className='rounded-md bg-spaces-foreground/8'
          style={{
            width: previewWidth,
            height: PREVIEW_BAR_HEIGHT,
            marginTop:
              (DM_TITLE_LINE_HEIGHT - TITLE_BAR_HEIGHT) / 2 +
              DM_PREVIEW_GAP +
              (DM_PREVIEW_LINE_HEIGHT - PREVIEW_BAR_HEIGHT) / 2,
          }}
        />
      </View>

      <View style={{ paddingLeft: 8, paddingTop: DM_META_TOP }}>
        <View
          className='rounded-md bg-spaces-foreground/8'
          style={{
            width: TIMESTAMP_BAR_WIDTH,
            height: TIMESTAMP_BAR_HEIGHT,
            marginTop: (DM_TIMESTAMP_LINE_HEIGHT - TIMESTAMP_BAR_HEIGHT) / 2,
          }}
        />
      </View>
    </View>
  );
}

type DmListSkeletonProps = {
  rows: number;
  accessibilityLabel: string;
};

/** `rows` placeholder rows under one shared pulse. */
export function DmListSkeleton({ rows, accessibilityLabel }: DmListSkeletonProps): ReactElement {
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(0.55, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    return (): void => cancelAnimation(pulse);
  }, [pulse]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={animatedStyle}
      accessible
      accessibilityRole='progressbar'
      accessibilityLabel={accessibilityLabel}
    >
      {Array.from({ length: rows }, (_, index) => (
        <DmRowSkeleton key={index} index={index} />
      ))}
    </Animated.View>
  );
}
