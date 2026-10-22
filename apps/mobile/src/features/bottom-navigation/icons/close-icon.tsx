import * as React from 'react';
import { NAV_ICON_STROKE_WIDTH } from '../constants';
import Svg, { Path, type SvgProps } from 'react-native-svg';

function CloseIcon({
  width = 16,
  height = 16,
  color = '#17181C',
  strokeWidth = NAV_ICON_STROKE_WIDTH,
  ...props
}: SvgProps): React.ReactElement {
  const stroke = props.stroke ?? color;

  return (
    <Svg width={width} height={height} viewBox='0 0 16 16' fill='none' {...props}>
      <Path
        d='M4 4L12 12M12 4L4 12'
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </Svg>
  );
}

export default CloseIcon;
