import { LinearGradient } from 'expo-linear-gradient';
import type { StyleProp, ViewStyle } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { contentFadeGradient } from './content-fade-gradient';

type TopContentFadeProps = {
  height: number;
  extraHeight?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
};

export function TopContentFade({ height, extraHeight = 0, color, style }: TopContentFadeProps) {
  const tabsScreenColor = useCSSVariable('--color-tabs-screen') as string;
  const fill = color ?? tabsScreenColor;
  const resolvedHeight = height + extraHeight;
  const { colors, locations } = contentFadeGradient(fill, 'top', resolvedHeight);

  return (
    <LinearGradient
      key={fill}
      pointerEvents='none'
      colors={colors}
      locations={locations}
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: resolvedHeight,
          zIndex: 10,
        },
        style,
      ]}
    />
  );
}
