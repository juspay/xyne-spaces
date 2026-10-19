import * as React from 'react';
import { NAV_ICON_STROKE_WIDTH } from '../constants';
import Svg, { Path, type SvgProps } from 'react-native-svg';

function MorningBriefIcon({
  width = 24,
  height = 24,
  color = '#17181C',
  strokeWidth = NAV_ICON_STROKE_WIDTH,
  ...props
}: SvgProps): React.ReactElement {
  const stroke = props.stroke ?? color;

  return (
    <Svg width={width} height={height} viewBox='0 0 24 24' fill='none' {...props}>
      <Path
        d='M20 11C20 9.3431 18.6569 8 17 8H16.4C16.0284 8 15.8426 8 15.6871 7.9754C14.8313 7.8398 14.1602 7.1687 14.0246 6.3129C14 6.1574 14 5.9716 14 5.6V5C14 3.3431 12.6569 2 11 2M20 11V10C20 5.5817 16.4183 2 12 2H11M20 11V18C20 20.2091 18.2091 22 16 22H8C5.79086 22 4 20.2091 4 18V6C4 3.7909 5.79086 2 8 2H11M8 17H8.01M12 10C11.3625 11.6165 10.6609 12.345 9 13C10.6609 13.655 11.3625 14.3835 12 16C12.6375 14.3835 13.3391 13.655 15 13C13.3391 12.345 12.6375 11.6165 12 10Z'
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </Svg>
  );
}

export default MorningBriefIcon;
