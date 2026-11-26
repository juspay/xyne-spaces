import { ChevronRight } from 'lucide-react-native';
import type { ReactElement, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';

import {
  CHANNEL_INFO_ROW_CHEVRON_SIZE,
  CHANNEL_INFO_ROW_GAP,
  CHANNEL_INFO_ROW_HEIGHT,
  CHANNEL_INFO_ROW_PADDING_X,
} from '../constants';

type ChannelInfoRowProps = {
  /** The 20 icon, or the members row's faces, drawn by the caller. */
  leading: ReactNode;
  label: string;
  /** The members row's line is a 12 caption; every other row's label is a 16 title. */
  caption?: boolean;
  /** A short value before the chevron ("Checkout v2"). */
  value?: string | null;
  /** A control in place of the chevron (the Starred toggle); the row itself then doesn't press. */
  trailing?: ReactNode;
  /** Text/Lowest, for the chevron. */
  chevronColor: string;
  /** Without it the row is a plain line (no chevron). */
  onPress?: () => void;
  /** The chevron is for rows that open another screen or sheet. */
  chevron?: boolean;
  /** Leave: the label in the danger colour and a warning tick on press, as the classic Leave button. */
  destructive?: boolean;
  accessibilityLabel?: string;
};

/**
 * Figma "Channel info" row: a 48 line of icon, label, optional value and
 * chevron. Not memoised: its callers draw `leading` and `onPress` fresh.
 */
export function ChannelInfoRow({
  leading,
  label,
  caption = false,
  value = null,
  trailing,
  chevronColor,
  onPress,
  chevron = true,
  destructive = false,
  accessibilityLabel,
}: ChannelInfoRowProps): ReactElement {
  const content = (
    <>
      {leading}
      <Text
        numberOfLines={1}
        className={cn(
          'min-w-0 flex-1',
          caption
            ? 'text-[12px] leading-4 text-spaces-muted'
            : 'text-[16px] font-medium leading-5 tracking-[-0.24px]',
          !caption && (destructive ? 'text-spaces-negative' : 'text-spaces-foreground'),
        )}
      >
        {label}
      </Text>
      {value === null ? null : (
        <Text numberOfLines={1} className='shrink text-[12px] leading-4 text-spaces-subtle'>
          {value}
        </Text>
      )}
      {trailing}
      {onPress && chevron && trailing === undefined ? (
        <ChevronRight size={CHANNEL_INFO_ROW_CHEVRON_SIZE} color={chevronColor} />
      ) : null}
    </>
  );

  if (!onPress || trailing !== undefined) {
    return (
      <View className='flex-row items-center' style={styles.row}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={accessibilityLabel ?? (value === null ? label : `${label}, ${value}`)}
      onPressIn={() => void (destructive ? haptics.warning() : haptics.buttonTap())}
      onPress={onPress}
      className='flex-row items-center active:opacity-60'
      style={styles.row}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    height: CHANNEL_INFO_ROW_HEIGHT,
    paddingHorizontal: CHANNEL_INFO_ROW_PADDING_X,
    columnGap: CHANNEL_INFO_ROW_GAP,
  },
});
