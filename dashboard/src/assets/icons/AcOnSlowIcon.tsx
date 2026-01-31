import React from 'react';

type IconProps = {
  size?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
};

const AcOnSlow: React.FC<IconProps> = ({
  size = 14,
  color = '#788187',
  strokeWidth = 1.2,
  className,
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox='0 0 14 14'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
    >
      <path
        d='M10.4993 4.66927H9.33268M6.99935 9.33594V11.6693M9.91602 9.33594V10.9693M4.08268 9.33594V10.9693M12.8327 7.0026V3.5026C12.8327 2.85827 12.3103 2.33594 11.666 2.33594H2.33268C1.68835 2.33594 1.16602 2.85827 1.16602 3.5026V7.0026H12.8327Z'
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
};

export default AcOnSlow;
