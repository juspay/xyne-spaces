import * as React from 'react';
import { NAV_ICON_STROKE_WIDTH } from '../constants';
import Svg, { G, Path, type SvgProps } from 'react-native-svg';

function HomeIcon({
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
          d='M12 3.39992C12.4179 3.39846 12.832 3.4799 13.2182 3.63953C13.6044 3.79917 13.9551 4.03383 14.25 4.32992L19.59 9.66992C20.1758 10.264 20.503 11.0656 20.5 11.8999V17.0199C20.5 17.9455 20.1323 18.8332 19.4778 19.4877C18.8233 20.1422 17.9356 20.5099 17.01 20.5099H6.99C6.0644 20.5099 5.1767 20.1422 4.5222 19.4877C3.8677 18.8332 3.5 17.9455 3.5 17.0199V11.8999C3.49705 11.0656 3.82418 10.264 4.41 9.66992L9.75 4.32992C10.0449 4.03383 10.3956 3.79917 10.7818 3.63953C11.1681 3.4799 11.5821 3.39846 12 3.39992Z'
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap='round'
          strokeLinejoin='round'
        />
        <Path
          d='M8.7 16.3999H15.3'
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </G>
    </Svg>
  );
}

export default HomeIcon;
