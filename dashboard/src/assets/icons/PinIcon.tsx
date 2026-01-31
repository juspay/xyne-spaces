import React from 'react';

interface PinIconProps {
  className?: string;
}

export const PinIcon: React.FC<PinIconProps> = ({ className }) => (
  <svg
    width='20'
    height='20'
    viewBox='0 0 24 24'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <path
      d='M16 12V4H17C17.55 4 18 3.55 18 3C18 2.45 17.55 2 17 2H7C6.45 2 6 2.45 6 3C6 3.55 6.45 4 7 4H8V12L6 14V16H11V22H13V16H18V14L16 12ZM14 14H10V12.5L12 10.5L14 12.5V14Z'
      fill='currentColor'
    />
  </svg>
);
