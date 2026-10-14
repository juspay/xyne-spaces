import React from 'react';
import Svg, { Path } from 'react-native-svg';

interface MoreHorizontalProps {
  size?: number;
  color?: string;
  fill?: boolean;
}

const MoreHorizontal: React.FC<MoreHorizontalProps> = ({
  size = 24,
  color = '#000',
  fill = false,
  ...props
}) => (
  <Svg width={size} height={size} viewBox='0 0 24 24' fill='none' {...props}>
    {fill ? (
      // 🔵 FILLED (ACTIVE)
      <Path
        fill={color}
        d='M4 12a2.5 2.5 0 1 1 0 5a2.5 2.5 0 0 1 0-5m8 0a2.5 2.5 0 1 1 0 5a2.5 2.5 0 0 1 0-5m8 0a2.5 2.5 0 1 1 0 5a2.5 2.5 0 0 1 0-5'
      />
    ) : (
      // ⚪ OUTLINE (INACTIVE)
      <Path
        fill={color}
        d='M12 14.5c-1.4 0-2.5-1.1-2.5-2.5S10.6 9.5 12 9.5s2.5 1.1 2.5 2.5s-1.1 2.5-2.5 2.5m0-3.5c-.6 0-1 .4-1 1s.4 1 1 1s1-.4 1-1s-.4-1-1-1m7 3.5c-1.4 0-2.5-1.1-2.5-2.5S17.6 9.5 19 9.5s2.5 1.1 2.5 2.5s-1.1 2.5-2.5 2.5m0-3.5c-.6 0-1 .4-1 1s.4 1 1 1s1-.4 1-1s-.4-1-1-1M5 14.5c-1.4 0-2.5-1.1-2.5-2.5S3.6 9.5 5 9.5s2.5 1.1 2.5 2.5S6.4 14.5 5 14.5m0-3.5c-.6 0-1 .4-1 1s.4 1 1 1s1-.4 1-1s-.4-1-1-1'
      />
    )}
  </Svg>
);

export default MoreHorizontal;
