import React from 'react';

export const TicketPriorityIcon: React.FC<{ color?: string; size?: number }> = ({
  color = '#646464',
  size,
}) => (
  <svg
    width={size || 12}
    height={size || 12}
    viewBox='0 0 10 8'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
  >
    <rect y='4.24512' width='2.12264' height='3.53774' rx='1.06132' fill={color} />
    <rect x='3.8916' y='2.12305' width='2.12264' height='5.66038' rx='1.06132' fill={color} />
    <rect x='7.7832' width='2.12264' height='7.78302' rx='1.06132' fill={color} />
  </svg>
);
