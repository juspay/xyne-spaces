import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import { type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { cn } from '@/src/utils/cn';

import {
  PLUS_TRAY_CHEVRON_SIZE,
  PLUS_TRAY_ICON_SIZE,
  PLUS_TRAY_ROW_GAP,
  PLUS_TRAY_ROW_MIN_HEIGHT,
  PLUS_TRAY_ROW_PADDING_X,
  PLUS_TRAY_ROW_PADDING_Y,
  PLUS_TRAY_ROW_WORDS_GAP,
} from '../constants';
import type { TrayRow } from '../model/tray-card';

export type TrayRowButtonProps<Id extends string> = {
  row: TrayRow<Id>;
  icon: LucideIcon;
  /** Text/Default, for the icon. */
  iconColor: string;
  /** Text/Lowest, for the chevron and a disabled row's icon. */
  lowestColor: string;
  onPress: (id: Id) => void;
};

/**
 * Figma "Plus tray" row: an icon, the title over an optional subtitle, and a
 * chevron. A disabled row keeps its place, its words in Text/Lowest.
 */
export function TrayRowButton<Id extends string>({
  row,
  icon,
  iconColor,
  lowestColor,
  onPress,
}: TrayRowButtonProps<Id>): ReactElement {
  const Icon = icon;
  return (
    <Pressable
      accessibilityRole='button'
      // The subtitle is the row's state ("You're offline", a time), so it is read with the title.
      accessibilityLabel={row.subtitle === null ? row.title : `${row.title}, ${row.subtitle}`}
      accessibilityState={{ disabled: row.disabled }}
      disabled={row.disabled}
      onPress={() => onPress(row.id)}
      className='flex-row items-center active:opacity-60'
      style={styles.row}
    >
      <Icon size={PLUS_TRAY_ICON_SIZE} color={row.disabled ? lowestColor : iconColor} />
      <View className='min-w-0 flex-1' style={styles.words}>
        <Text
          numberOfLines={1}
          className={cn(
            'text-[16px] font-medium leading-[20px]',
            row.disabled ? 'text-spaces-subtle' : 'text-spaces-foreground',
          )}
        >
          {row.title}
        </Text>
        {row.subtitle === null ? null : (
          <Text
            numberOfLines={1}
            className={cn(
              'text-[14px] leading-[20px]',
              row.disabled ? 'text-spaces-subtle' : 'text-spaces-muted',
            )}
          >
            {row.subtitle}
          </Text>
        )}
      </View>
      <ChevronRight size={PLUS_TRAY_CHEVRON_SIZE} color={lowestColor} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: PLUS_TRAY_ROW_MIN_HEIGHT,
    paddingHorizontal: PLUS_TRAY_ROW_PADDING_X,
    paddingVertical: PLUS_TRAY_ROW_PADDING_Y,
    columnGap: PLUS_TRAY_ROW_GAP,
  },
  words: { rowGap: PLUS_TRAY_ROW_WORDS_GAP },
});
