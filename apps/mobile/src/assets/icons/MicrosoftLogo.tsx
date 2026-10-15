import React from 'react';
import Svg, { Rect } from 'react-native-svg';

interface MicrosoftLogoProps {
  width?: number;
  height?: number;
}

export const MicrosoftLogo: React.FC<MicrosoftLogoProps> = ({ width = 18, height = 18 }) => (
  <Svg width={width} height={height} viewBox='0 0 21 21'>
    <Rect x='1' y='1' width='9' height='9' fill='#f25022' />
    <Rect x='1' y='11' width='9' height='9' fill='#00a4ef' />
    <Rect x='11' y='1' width='9' height='9' fill='#7fba00' />
    <Rect x='11' y='11' width='9' height='9' fill='#ffb900' />
  </Svg>
);

export default MicrosoftLogo;
