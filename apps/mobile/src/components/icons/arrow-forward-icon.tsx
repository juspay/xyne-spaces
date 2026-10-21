import * as React from 'react';
import Svg, { Path, type SvgProps } from 'react-native-svg';

function ArrowForwardIcon({
  width: svgWidth,
  height: svgHeight,
  color,
  ...restProps
}: SvgProps): React.ReactElement {
  const width = svgWidth ?? 20;
  const height = svgHeight ?? 20;
  const fill = color ?? 'currentColor';

  return (
    <Svg viewBox='0 0 24 24' width={width} height={height} {...restProps}>
      <Path
        fill={fill}
        d='M13 5.499a.996.996 0 0 0-1 1v2.559c-4.5.498-8 4.309-8 8.941v1c2.245-3.423 5.25-3.92 8-3.989v2.489a.999.999 0 0 0 1.707.707L20 11.999l-6.293-6.208A1 1 0 0 0 13 5.499'
      />
    </Svg>
  );
}

export default ArrowForwardIcon;
