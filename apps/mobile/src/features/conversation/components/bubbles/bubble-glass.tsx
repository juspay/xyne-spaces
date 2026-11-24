import { memo, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useUniwind } from 'uniwind';

import { BUBBLE_GLASS_BLUR } from '../../constants';

type BubbleGlassProps = {
  /** The tint's class (`bg-spaces-foreground`, `bg-status-danger`). */
  tintClassName: string;
  tintOpacity: number;
};

/**
 * Figma's "Glass" under the edge tab and the close target: the page blurred,
 * then a tint over it. Fills its parent, which clips it to its shape.
 */
export const BubbleGlass = memo(function BubbleGlass({
  tintClassName,
  tintOpacity,
}: BubbleGlassProps): ReactElement {
  const { theme } = useUniwind();
  return (
    <>
      <BlurView
        intensity={BUBBLE_GLASS_BLUR}
        tint={theme === 'dark' ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
      />
      <View className={tintClassName} style={[StyleSheet.absoluteFill, { opacity: tintOpacity }]} />
    </>
  );
});
