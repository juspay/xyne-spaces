import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

interface CircleRingProps {
  /** Diameter of the round surface the ring sits on. */
  size: number;
  color: string;
  width?: number;
}

/**
 * The thin ring around a round surface (avatars, round glass buttons), drawn as one antialiased
 * circle that fills its parent.
 *
 * Don't use `borderWidth` for this. On Android a rounded border is stroked inside a hard-edged
 * clip of the view's own outline, which keeps the ring at full strength where the circle runs
 * along the pixel grid (top, bottom, left, right) and thins it on the curve in between — on a
 * faint translucent ring that reads as four dots around the circle.
 */
export function CircleRing({ size, color, width = 1 }: CircleRingProps): React.ReactElement {
  return (
    <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents='none'>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={(size - width) / 2}
        stroke={color}
        strokeWidth={width}
        fill='none'
      />
    </Svg>
  );
}
