import React from 'react';

interface ThreadIconProps {
  color?: string;
}

export const ThreadIcon: React.FC<ThreadIconProps> = ({ color = '#181B1D' }) => (
  <svg width='16' height='16' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'>
    <path
      d='M2 10.668L4.66667 13.3346L7.33333 10.668'
      stroke={color}
      strokeWidth='1.33333'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M4.66699 13.3346V2.66797'
      stroke={color}
      strokeWidth='1.33333'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M7.33301 2.66797H9.99967'
      stroke={color}
      strokeWidth='1.33333'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M7.33301 5.33203H11.9997'
      stroke={color}
      strokeWidth='1.33333'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M7.33301 8H13.9997'
      stroke={color}
      strokeWidth='1.33333'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);
