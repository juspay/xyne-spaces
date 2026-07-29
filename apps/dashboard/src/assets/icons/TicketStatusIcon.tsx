import React from 'react';

export const TicketStatusIcon: React.FC<{ color?: string; size?: number }> = ({
  color = 'var(--status-scheduled)',
  size,
}) => (
  <svg
    width={size || 12}
    height={size || 12}
    viewBox='0 0 14 14'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
  >
    <rect
      x='0.777778'
      y='0.777778'
      width='12.4444'
      height='12.4444'
      rx='6.22222'
      stroke={color}
      strokeWidth='1.55556'
    />
    <path
      d='M6.99978 10.8891C8.03118 10.8891 9.02033 10.4794 9.74964 9.75008C10.479 9.02077 10.8887 8.03162 10.8887 7.00022C10.8887 5.96882 10.479 4.97967 9.74964 4.25036C9.02033 3.52105 8.03118 3.11133 6.99978 3.11133L6.99978 7.00022L6.99978 10.8891Z'
      fill={color}
    />
  </svg>
);
