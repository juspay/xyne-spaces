import React from 'react';
import Svg, { Path, Circle } from 'react-native-svg';
import { callColors } from '../callTheme';

interface IconProps {
  size?: number;
  color?: string;
}

export function MicIcon({ size = 24, color = callColors.onColor }: IconProps): React.ReactElement {
  return (
    <Svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke={color}
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <Path d='M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z' />
      <Path d='M19 10v2a7 7 0 0 1-14 0v-2' />
      <Path d='M12 19v3' />
    </Svg>
  );
}

export function MicOffIcon({
  size = 24,
  color = callColors.onColor,
}: IconProps): React.ReactElement {
  return (
    <Svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke={color}
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <Path d='m2 2 20 20' />
      <Path d='M18.89 13.23A7.12 7.12 0 0 0 19 12v-2' />
      <Path d='M5 10v2a7 7 0 0 0 12 5' />
      <Path d='M15 9.34V5a3 3 0 0 0-5.68-1.33' />
      <Path d='M9 9v3a3 3 0 0 0 5.12 2.12' />
      <Path d='M12 19v3' />
    </Svg>
  );
}

export function VideoIcon({
  size = 24,
  color = callColors.onColor,
}: IconProps): React.ReactElement {
  return (
    <Svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke={color}
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <Path d='m22 8-6 4 6 4V8Z' />
      <Path d='M4 5h10c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V7c0-1.1.9-2 2-2Z' />
    </Svg>
  );
}

export function VideoOffIcon({
  size = 24,
  color = callColors.onColor,
}: IconProps): React.ReactElement {
  return (
    <Svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke={color}
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <Path d='M10.66 6H14a2 2 0 0 1 2 2v2.5l6-4v11l-6-4V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2' />
      <Path d='m2 2 20 20' />
    </Svg>
  );
}

export function PhoneOffIcon({
  size = 24,
  color = callColors.onColor,
}: IconProps): React.ReactElement {
  return (
    <Svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke={color}
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <Path d='M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91' />
      <Path d='m22 2-20 20' />
    </Svg>
  );
}

export function ScreenShareIcon({
  size = 24,
  color = callColors.onColor,
}: IconProps): React.ReactElement {
  return (
    <Svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke={color}
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <Path d='M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3' />
      <Path d='M8 21h8' />
      <Path d='M12 17v4' />
      <Path d='m17 8 5-5' />
      <Path d='M17 3h5v5' />
    </Svg>
  );
}

export function ScreenShareOffIcon({
  size = 24,
  color = callColors.onColor,
}: IconProps): React.ReactElement {
  return (
    <Svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke={color}
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <Path d='M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3' />
      <Path d='M8 21h8' />
      <Path d='M12 17v4' />
      <Path d='m2 2 20 20' />
    </Svg>
  );
}

export function BotIcon({ size = 24, color = callColors.onColor }: IconProps): React.ReactElement {
  return (
    <Svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke={color}
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <Path d='M12 8V4H8' />
      <Path d='M2 14h2' />
      <Path d='M20 14h2' />
      <Path d='M15 13v2' />
      <Path d='M9 13v2' />
      <Circle cx='12' cy='6' r='2' />
      <Path d='M6 18h12a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2z' />
      <Path d='M9 22v-4' />
      <Path d='M15 22v-4' />
    </Svg>
  );
}

export function MoreHorizontalIcon({
  size = 24,
  color = callColors.onColor,
}: IconProps): React.ReactElement {
  return (
    <Svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke={color}
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <Circle cx='12' cy='12' r='1' />
      <Circle cx='19' cy='12' r='1' />
      <Circle cx='5' cy='12' r='1' />
    </Svg>
  );
}

export function SpeakerIcon({
  size = 24,
  color = callColors.onColor,
}: IconProps): React.ReactElement {
  return (
    <Svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke={color}
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <Path d='M11 5 6 9H2v6h4l5 4V5Z' />
      <Path d='M15.54 8.46a5 5 0 0 1 0 7.07' />
      <Path d='M19.07 4.93a10 10 0 0 1 0 14.14' />
    </Svg>
  );
}

export function FlipCameraIcon({
  size = 24,
  color = callColors.onColor,
}: IconProps): React.ReactElement {
  return (
    <Svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke={color}
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <Path d='M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5' />
      <Path d='M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5' />
      <Circle cx='12' cy='12' r='3' />
      <Path d='m18 22-3-3 3-3' />
      <Path d='m6 2 3 3-3 3' />
    </Svg>
  );
}

export function BluetoothIcon({
  size = 24,
  color = callColors.onColor,
}: IconProps): React.ReactElement {
  return (
    <Svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke={color}
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <Path d='m7 7 10 10-5 5V2l5 5L7 17' />
    </Svg>
  );
}

export function HeadphonesIcon({
  size = 24,
  color = callColors.onColor,
}: IconProps): React.ReactElement {
  return (
    <Svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke={color}
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <Path d='M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3' />
    </Svg>
  );
}

export function EarpieceIcon({
  size = 24,
  color = callColors.onColor,
}: IconProps): React.ReactElement {
  return (
    <Svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke={color}
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <Path d='M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z' />
    </Svg>
  );
}

// New icons for dashboard parity
export function UsersIcon({
  size = 24,
  color = callColors.onColor,
}: IconProps): React.ReactElement {
  return (
    <Svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke={color}
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <Path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' />
      <Circle cx='9' cy='7' r='4' />
      <Path d='M22 21v-2a4 4 0 0 0-3-3.87' />
      <Path d='M16 3.13a4 4 0 0 1 0 7.75' />
    </Svg>
  );
}

export function ShareIcon({
  size = 24,
  color = callColors.onColor,
}: IconProps): React.ReactElement {
  return (
    <Svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke={color}
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <Path d='M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8' />
      <Path d='m16 6-4-4-4 4' />
      <Path d='M12 2v13' />
    </Svg>
  );
}

export function MessageSquareIcon({
  size = 24,
  color = callColors.onColor,
}: IconProps): React.ReactElement {
  return (
    <Svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke={color}
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <Path d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' />
    </Svg>
  );
}

export function MaximizeIcon({
  size = 24,
  color = callColors.onColor,
}: IconProps): React.ReactElement {
  return (
    <Svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke={color}
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <Path d='M15 3h6v6' />
      <Path d='M9 21H3v-6' />
      <Path d='M21 3l-7 7' />
      <Path d='M3 21l7-7' />
    </Svg>
  );
}

export function MinimizeIcon({
  size = 24,
  color = callColors.onColor,
}: IconProps): React.ReactElement {
  return (
    <Svg
      width={size}
      height={size}
      viewBox='0 0 24 24'
      fill='none'
      stroke={color}
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      <Path d='M4 14h6v6' />
      <Path d='M20 10h-6V4' />
      <Path d='M14 10l7-7' />
      <Path d='M10 14l-7 7' />
    </Svg>
  );
}
