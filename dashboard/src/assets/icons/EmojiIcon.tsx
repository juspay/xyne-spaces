import React from 'react';

interface EmojiIconProps {
  color?: string;
}

export const EmojiIcon: React.FC<EmojiIconProps> = ({ color = '#181B1D' }) => (
  <svg width='16' height='16' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'>
    <path
      d='M14.6672 7.3342V8.00086C14.6605 9.34641 14.2467 10.6584 13.4804 11.7644C12.714 12.8704 11.6309 13.7186 10.3735 14.1976C9.11603 14.6765 7.74309 14.7637 6.43515 14.4477C5.12721 14.1317 3.9455 13.4274 3.04536 12.4272C2.14523 11.4271 1.56881 10.1779 1.39187 8.84406C1.21494 7.51018 1.44579 6.15398 2.05406 4.95375C2.66233 3.75352 3.61955 2.76545 4.79988 2.11942C5.98022 1.47339 7.32842 1.19966 8.66724 1.3342'
      stroke={color}
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M5.33398 9.33398C5.33398 9.33398 6.33398 10.6673 8.00065 10.6673C9.66732 10.6673 10.6673 9.33398 10.6673 9.33398'
      stroke={color}
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M6 6H6.00667'
      stroke={color}
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M10 6H10.0067'
      stroke={color}
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M10.666 3.33398H14.666'
      stroke={color}
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
    <path
      d='M12.666 1.33398V5.33398'
      stroke={color}
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
);
