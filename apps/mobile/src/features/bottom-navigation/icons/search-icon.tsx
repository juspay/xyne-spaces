import * as React from 'react';
import { NAV_ICON_STROKE_WIDTH } from '../constants';
import Svg, { G, Path, type SvgProps } from 'react-native-svg';

function SearchIcon({
  width = 20,
  height = 20,
  color = '#17181C',
  strokeWidth = NAV_ICON_STROKE_WIDTH,
  ...props
}: SvgProps): React.ReactElement {
  const stroke = props.stroke ?? color;

  return (
    <Svg width={width} height={height} viewBox='0 0 20 20' fill='none' {...props}>
      <G>
        <Path
          d='M17.5 17.5L12.4581 12.4581M12.4581 12.4581C13.5138 11.4025 14.1667 9.94417 14.1667 8.33333C14.1667 5.11168 11.555 2.5 8.33333 2.5C5.11168 2.5 2.5 5.11168 2.5 8.33333C2.5 11.555 5.11168 14.1667 8.33333 14.1667C9.94417 14.1667 11.4025 13.5138 12.4581 12.4581Z'
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </G>
    </Svg>
  );
}

export default SearchIcon;
