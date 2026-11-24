import React from 'react';
import Svg, { Path } from 'react-native-svg';

interface Spark4IconProps {
  size?: number;
  color?: string;
}

const Spark4Icon: React.FC<Spark4IconProps> = ({ size = 20, color = '#000' }) => (
  <Svg width={size} height={size} viewBox='0 0 20 20' fill='none'>
    <Path
      d='M10 2C10.1667 7.58333 12.4167 9.83333 18 10C12.4167 10.1667 10.1667 12.4167 10 18C9.83333 12.4167 7.58333 10.1667 2 10C7.58333 9.83333 9.83333 7.58333 10 2Z'
      stroke={color}
      strokeWidth={1.67}
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </Svg>
);

export default Spark4Icon;
