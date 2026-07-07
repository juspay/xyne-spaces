import React from 'react';

interface XyneTelepresenceIconProps {
  className?: string;
  style?: React.CSSProperties | undefined;
}

export const XyneTelepresenceIcon: React.FC<XyneTelepresenceIconProps> = ({ className, style }) => (
  <svg
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='2'
    strokeLinecap='round'
    strokeLinejoin='round'
    className={className}
    style={style}
    aria-hidden='true'
    role='img'
  >
    <path d='M11 4 H6 a2 2 0 0 0-2 2 v12 a2 2 0 0 0 2 2 h12 a2 2 0 0 0 2-2 v-6' />
    <circle cx='12' cy='11' r='2.5' fill='currentColor' stroke='none' />
    <path d='M7 19 c0-2.5 2.5-4 5-4 s5 1.5 5 4' fill='currentColor' stroke='none' />
    <path
      d='M16 2.5 Q16 7 20.5 7 Q16 7 16 11.5 Q16 7 11.5 7 Q16 7 16 2.5 Z'
      fill='currentColor'
      stroke='none'
    />
    <path
      d='M21 1.5 Q21 3 22.5 3 Q21 3 21 4.5 Q21 3 19.5 3 Q21 3 21 1.5 Z'
      fill='currentColor'
      stroke='none'
    />
  </svg>
);
