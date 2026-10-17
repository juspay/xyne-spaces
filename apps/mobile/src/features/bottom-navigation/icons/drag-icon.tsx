import * as React from 'react';
import Svg, { G, Path, type SvgProps } from 'react-native-svg';

/** Grip on a reorderable row. Carries its own dimming, so pass a solid colour. */
function DragIcon({
  width = 18,
  height = 18,
  color = '#17181C',
  strokeWidth = 1.275,
  opacity = 0.26,
  ...props
}: SvgProps): React.ReactElement {
  const stroke = props.stroke ?? color;

  return (
    <Svg width={width} height={height} viewBox='0 0 18 18' fill='none' {...props}>
      <G opacity={opacity}>
        <Path
          d='M3 6.75H15M3 11.25H15'
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </G>
    </Svg>
  );
}

export default DragIcon;
