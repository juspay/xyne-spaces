import { memo, type ReactElement } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useCSSVariable, useUniwind } from 'uniwind';

import { BlurSurface } from '@/modules/xyne-blur';

import { TAB_BAR_FADE_HEIGHT } from '../constants';

type TabBarBackdropProps = {
  /** From the bottom edge of the screen up to where the fade starts. */
  height: number;
};

/**
 * The blur behind the bottom bar, faded in from above.
 *
 * One frosted surface across the band, with no tint of its own: the screen
 * behind it, blurred and colour-boosted, and nothing else. The fade mask then
 * hides it at the band's top edge and lets it in over the next 40dp, so the
 * blur seems to build up towards the bar; from there down it shows in full,
 * behind the pill and the system navigation alike.
 *
 * On Android it blurs only what sits inside a `BlurTarget`; elsewhere the band
 * is the screen's own colour, faded in the same way.
 */
export const TabBarBackdrop = memo(function TabBarBackdrop({
  height,
}: TabBarBackdropProps): ReactElement | null {
  const { theme } = useUniwind();
  const base = useCSSVariable('--color-spaces-background') as string;

  if (Platform.OS === 'web') return null;

  return (
    <View pointerEvents='none' style={[styles.band, { height }]}>
      <BlurSurface
        style={StyleSheet.absoluteFill}
        baseColor={base}
        tintColor={base}
        tintAlpha={0}
        colorScheme={theme === 'dark' ? 'dark' : 'light'}
        material='frost'
        fadeHeight={TAB_BAR_FADE_HEIGHT}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
