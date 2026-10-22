import * as React from 'react';
import { NAV_ICON_STROKE_WIDTH } from '../constants';
import Svg, { G, Path, type SvgProps } from 'react-native-svg';

function ChevronsIcon({
  width = 24,
  height = 24,
  color = '#17181C',
  strokeWidth = NAV_ICON_STROKE_WIDTH,
  ...props
}: SvgProps): React.ReactElement {
  const stroke = props.stroke ?? color;

  return (
    <Svg width={width} height={height} viewBox='0 0 24 24' fill='none' {...props}>
      <G>
        <Path
          d='M16 9C14.9379 7.53812 13.6929 6.22872 12.2979 5.1058C12.1226 4.96473 11.8774 4.96473 11.7021 5.1058C10.3071 6.22872 9.06206 7.53812 8 9M8 15C9.06206 16.4619 10.3071 17.7713 11.7021 18.8942C11.8774 19.0353 12.1226 19.0353 12.2979 18.8942C13.6929 17.7713 14.9379 16.4619 16 15'
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </G>
    </Svg>
  );
}

export default ChevronsIcon;
