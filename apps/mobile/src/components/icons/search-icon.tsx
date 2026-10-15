import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

interface SearchIconProps {
  size?: number;
  color?: string;
  fill?: boolean;
}

const SearchIcon: React.FC<SearchIconProps> = ({ size = 24, color = '#000' }) => (
  <Svg width={size} height={size} viewBox='0 0 24 24' fill='none'>
    <Circle
      cx={11}
      cy={11}
      r={7}
      stroke={color}
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <Path
      d='m20 20l-3.5-3.5'
      stroke={color}
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </Svg>
);

export default SearchIcon;
