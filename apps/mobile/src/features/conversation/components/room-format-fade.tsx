import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, type ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { withAlpha } from '@/src/utils/color';

import { TYPING_BAR_FORMAT_FADE_WIDTH } from '../constants';

const START = { x: 0, y: 0 } as const;
const END = { x: 1, y: 0 } as const;
const styles = StyleSheet.create({
  fade: {
    pointerEvents: 'none',
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: TYPING_BAR_FORMAT_FADE_WIDTH,
  },
});

/**
 * The formatting strip's right edge, fading into the card, so styles scrolled
 * under it read as more to come rather than cut off.
 */
export function RoomFormatFade(): ReactElement | null {
  const surface = useCSSVariable('--color-spaces-surface');
  // The card's own colour at no opacity: plain `transparent` would fade through grey on iOS.
  const colors = useMemo(
    () => (typeof surface === 'string' ? ([withAlpha(surface, 0), surface] as const) : null),
    [surface],
  );

  // A gradient takes real colours only, so nothing shows until the theme resolves.
  if (!colors) return null;

  return <LinearGradient colors={colors} start={START} end={END} style={styles.fade} />;
}
