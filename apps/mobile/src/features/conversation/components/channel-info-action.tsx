import { ChevronDown } from 'lucide-react-native';
import { memo, type ReactElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { haptics } from '@/src/utils/haptics';

import {
  CHANNEL_INFO_ACTION_CHEVRON_GAP,
  CHANNEL_INFO_ACTION_CHEVRON_SIZE,
  CHANNEL_INFO_ACTION_INNER_GAP,
  CHANNEL_INFO_ACTION_PADDING_X,
  CHANNEL_INFO_ACTION_PADDING_Y,
  CHANNEL_INFO_ACTION_RADIUS,
} from '../constants';

type ChannelInfoActionProps = {
  /** The 20 icon, drawn by the caller. */
  icon: ReactNode;
  label: string;
  /** Text/Default, for the Call plate's chevron. */
  color: string;
  /** Call carries the header's chevron, so the two read as the same control. */
  chevron?: boolean;
  /** For a toggle (Mute): whether it is on. */
  selected?: boolean;
  onPress: () => void;
};

/** Figma "Channel info" action: an equal-width plate with an icon over its label. */
export const ChannelInfoAction = memo(function ChannelInfoAction({
  icon,
  label,
  color,
  chevron = false,
  selected,
  onPress,
}: ChannelInfoActionProps): ReactElement {
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={label}
      {...(selected === undefined ? {} : { accessibilityState: { selected } })}
      onPressIn={() => void haptics.buttonTap()}
      onPress={onPress}
      className='min-w-0 flex-1 items-center bg-spaces-surface active:opacity-60'
      style={styles.plate}
    >
      {icon}
      <View className='flex-row items-center' style={styles.label}>
        <Text numberOfLines={1} className='text-[12px] leading-4 text-spaces-foreground'>
          {label}
        </Text>
        {chevron ? <ChevronDown size={CHANNEL_INFO_ACTION_CHEVRON_SIZE} color={color} /> : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  plate: {
    borderRadius: CHANNEL_INFO_ACTION_RADIUS,
    paddingHorizontal: CHANNEL_INFO_ACTION_PADDING_X,
    paddingVertical: CHANNEL_INFO_ACTION_PADDING_Y,
    rowGap: CHANNEL_INFO_ACTION_INNER_GAP,
  },
  label: { columnGap: CHANNEL_INFO_ACTION_CHEVRON_GAP },
});
