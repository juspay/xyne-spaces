import { type ReactElement, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { ChromeBlur } from '@/src/ui/chrome-blur';

/**
 * The title row's height, below the status bar.
 *
 * Fixed rather than measured, because the list under the header needs it on
 * its first frame: a measured height would arrive a frame late and the list
 * would jump by it.
 */
export const SPACES_HEADER_BAR_HEIGHT = 58;

/** The header's full height, status bar included — what a list pads its top by. */
export function useSpacesHeaderHeight(): number {
  return useSafeAreaInsets().top + SPACES_HEADER_BAR_HEIGHT;
}

export type SpacesHeaderProps = {
  title: string;
  trailing?: ReactNode;
};

/**
 * The header of a Spaces screen.
 *
 * Floats over the screen's list rather than sitting above it, so rows scroll
 * up under it and show through its frosted background. The list keeps its
 * first row clear of it by padding its top with `useSpacesHeaderHeight`, and
 * the screen wraps the list — not the header — in a `BlurTarget`.
 */
export function SpacesHeader({ title, trailing }: SpacesHeaderProps): ReactElement {
  const insets = useSafeAreaInsets();
  const background = useCSSVariable('--color-spaces-background') as string;

  return (
    // Takes its own touches: rows scroll under it now, and a tap on an empty
    // stretch of header must not land on the row hidden beneath.
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ChromeBlur variant='header' color={background} />
      <View
        pointerEvents='box-none'
        className='flex-row items-center justify-between px-4'
        style={styles.bar}
      >
        <Text className='text-[28px] font-semibold text-spaces-foreground'>{title}</Text>
        {trailing}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  bar: {
    height: SPACES_HEADER_BAR_HEIGHT,
  },
});
