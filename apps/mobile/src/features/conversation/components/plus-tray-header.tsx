import { X } from 'lucide-react-native';
import { type ComponentRef, type ReactElement, type RefObject } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import {
  PLUS_TRAY_CLOSE_ICON_SIZE,
  PLUS_TRAY_CLOSE_SIZE,
  PLUS_TRAY_HEADER_GAP,
  PLUS_TRAY_HEADER_HEIGHT,
  PLUS_TRAY_HEADER_PADDING_BOTTOM,
  PLUS_TRAY_HEADER_PADDING_LEFT,
  PLUS_TRAY_HEADER_PADDING_RIGHT,
  PLUS_TRAY_HEADER_PADDING_TOP,
} from '../constants';
import { colorOf } from '../model/token-color';
import { IconButton } from './icon-button';

type PlusTrayHeaderProps = {
  title: string;
  /** The title, where screen readers start once the tray is up. */
  titleRef: RefObject<ComponentRef<typeof Text> | null>;
  onClose: () => void;
};

/** Figma "Filter / Tray header": the title and a close plate, no divider. */
export function PlusTrayHeader({ title, titleRef, onClose }: PlusTrayHeaderProps): ReactElement {
  const foreground = colorOf(useCSSVariable('--color-spaces-foreground'));

  return (
    <View className='flex-row items-center' style={styles.header}>
      <Text
        ref={titleRef}
        accessibilityRole='header'
        numberOfLines={1}
        className='min-w-0 flex-1 text-[16px] font-medium leading-[20px] text-spaces-foreground'
      >
        {title}
      </Text>
      <IconButton
        label='Close'
        size={PLUS_TRAY_CLOSE_SIZE}
        onPress={onClose}
        className='bg-spaces-surface'
      >
        <X size={PLUS_TRAY_CLOSE_ICON_SIZE} color={foreground} />
      </IconButton>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: PLUS_TRAY_HEADER_HEIGHT,
    paddingTop: PLUS_TRAY_HEADER_PADDING_TOP,
    paddingBottom: PLUS_TRAY_HEADER_PADDING_BOTTOM,
    paddingLeft: PLUS_TRAY_HEADER_PADDING_LEFT,
    paddingRight: PLUS_TRAY_HEADER_PADDING_RIGHT,
    columnGap: PLUS_TRAY_HEADER_GAP,
  },
});
