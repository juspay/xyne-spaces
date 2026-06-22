import React from 'react';
import { cn } from '../../../utils/classNames';

interface TicketStatusIconProps {
  progressPercentage: number;
  size?: number;
}

export const TicketStatusIcon: React.FC<TicketStatusIconProps> = ({
  progressPercentage,
  size = 16,
}) => {
  const center = size / 2;
  const radius = size / 2 - 1;

  const polarToCartesian = (cx: number, cy: number, r: number, angle: number) => {
    const rad = (angle - 90) * (Math.PI / 180);
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  };

  const describeArc = (cx: number, cy: number, r: number, percent: number) => {
    if (percent <= 0) return '';

    const endAngle = (percent / 100) * 360;
    const start = polarToCartesian(cx, cy, r, 0);
    const end = polarToCartesian(cx, cy, r, endAngle);

    const largeArcFlag = endAngle > 180 ? 1 : 0;

    return `
      M ${cx} ${cy}
      L ${start.x} ${start.y}
      A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y}
      Z
    `;
  };

  const getColor = () => {
    if (progressPercentage === 100) return 'var(--status-success)';
    if (progressPercentage > 0) return 'var(--status-scheduled)';
    return 'transparent';
  };
  const color = getColor();
  const innerRadius = radius - 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Outer border */}
      <circle cx={center} cy={center} r={radius} fill='none' stroke={color} strokeWidth='2' />

      {/* Progress sector */}
      {progressPercentage > 0 && (
        <path d={describeArc(center, center, innerRadius, progressPercentage)} fill={color} />
      )}
    </svg>
  );
};

// calculate progress based on stages
// handles progress calculation
interface TicketStatusWithStagesProps {
  currentStageName: string | null;
  showLeadingDot?: boolean;
  iconOnly?: boolean;
  className?: string;
  iconClassName?: string;
  labelClassName?: string;
}

export const TicketStatusWithStages: React.FC<TicketStatusWithStagesProps> = ({
  currentStageName,
  showLeadingDot = true,
  iconOnly = false,
  className,
  labelClassName,
}) => {
  if (iconOnly) {
    return <TicketStatusIcon progressPercentage={25} size={12} />;
  }
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {showLeadingDot && <div className='rounded-full h-1 w-1 bg-muted-foreground'></div>}
      <TicketStatusIcon progressPercentage={25} size={12} />
      <span className={cn('text-xs line-clamp-1 break-all text-primary', labelClassName)}>
        {currentStageName || 'Not Started'}
      </span>
    </div>
  );
};
