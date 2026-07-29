import React from 'react';

interface InProgressIconProps {
  size?: number;
  color?: string;
  className?: string;
}

const InProgressIcon: React.FC<InProgressIconProps> = ({
  size = 16,
  color = 'var(--status-scheduled)',
  className,
}) => (
  <svg
    xmlns='http://www.w3.org/2000/svg'
    width={size}
    height={size}
    viewBox='0 0 10 10'
    fill='none'
    className={className}
  >
    <rect x={0.65} y={0.65} width={8.7} height={8.7} rx={4.35} stroke={color} strokeWidth={1.3} />
    <path
      d='M4.99957 7.77431C5.73628 7.77431 6.44282 7.48165 6.96375 6.96071C7.48469 6.43978 7.77734 5.73324 7.77734 4.99653C7.77734 4.25982 7.48469 3.55328 6.96375 3.03234C6.44282 2.51141 5.73628 2.21875 4.99957 2.21875L4.99957 4.99653L4.99957 7.77431Z'
      fill={color}
    />
  </svg>
);

export default InProgressIcon;
