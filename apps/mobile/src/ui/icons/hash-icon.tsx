import * as React from 'react';
import Svg, { Path, type SvgProps } from 'react-native-svg';

export type HashIconProps = SvgProps & {
  /** Shorthand for width and height, so it fits where a lucide icon does. */
  size?: number;
};

/** The channel mark. */
function HashIcon({
  size = 20,
  width = size,
  height = size,
  color = '#232229',
  strokeWidth = 1.58333,
  ...props
}: HashIconProps): React.ReactElement {
  const stroke = props.stroke ?? color;

  return (
    <Svg width={width} height={height} viewBox='0 0 20 20' fill='none' {...props}>
      <Path
        d='M5.83334 16.6667L6.61459 12.5M6.61459 12.5L7.55209 7.5M6.61459 12.5H12.4479M6.61459 12.5H2.91667M7.55209 7.5L8.33334 3.33333M7.55209 7.5H13.3854M7.55209 7.5H3.75001M12.4479 12.5L11.6667 16.6667M12.4479 12.5L13.3854 7.5M12.4479 12.5H16.25M13.3854 7.5L14.1667 3.33333M13.3854 7.5H17.0833'
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </Svg>
  );
}

export default HashIcon;
