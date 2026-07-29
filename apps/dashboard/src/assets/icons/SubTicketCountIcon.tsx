import React from 'react';

interface SubTicketCountIconProps {
  className?: string;
}

export const SubTicketCountIcon: React.FC<SubTicketCountIconProps> = ({ className }) => (
  <svg
    xmlns='http://www.w3.org/2000/svg'
    width='12'
    height='12'
    viewBox='0 0 12 12'
    fill='none'
    className={className}
    aria-hidden='true'
  >
    <path
      d='M1.58594 4.08939L7.08594 1.58939C7.3273 1.47985 7.60228 1.47062 7.85045 1.56371C8.09862 1.65681 8.29967 1.84463 8.40944 2.08589L9.27944 3.99939'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path d='M3 5V4' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' />
    <path d='M3 7V7.5' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' />
    <path d='M3 9.5V10.5' stroke='currentColor' strokeLinecap='round' strokeLinejoin='round' />
    <path
      d='M10 4H2C1.44772 4 1 4.44772 1 5V9.5C1 10.0523 1.44772 10.5 2 10.5H10C10.5523 10.5 11 10.0523 11 9.5V5C11 4.44772 10.5523 4 10 4Z'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);
