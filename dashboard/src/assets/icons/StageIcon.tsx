interface StageIconProps {
  color?: string;
  size?: number;
  className?: string;
}

export const StageCircleIcon: React.FC<StageIconProps> = ({
  size = 16,
  color = 'var(--status-success)',
  className,
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 10 10'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    className={className}
  >
    <rect x='0.65' y='0.65' width='8.7' height='8.7' rx='4.35' stroke={color} strokeWidth='1.3' />
    <circle cx='5' cy='5' r='2.78' fill={color} />
  </svg>
);
