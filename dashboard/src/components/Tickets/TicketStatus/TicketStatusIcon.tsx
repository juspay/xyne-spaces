import React from 'react';
import { cn } from '../../../utils/classNames';

interface Stage {
  id: string;
  name: string;
  sequenceNumber: number;
}

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
    if (progressPercentage === 100) return '#10B981';
    if (progressPercentage > 0) return '#3B82F6';
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
export const useStageProgress = (currentStageName: string | null, stages: Stage[] | null) => {
  return React.useMemo(() => {
    if (!stages || stages.length === 0 || !currentStageName) return 0;

    const currentStage = stages.find(s => s.name === currentStageName);
    if (!currentStage) return 0;

    const totalStages = stages.length;
    const currentSequence = currentStage.sequenceNumber;

    return Math.round((currentSequence / totalStages) * 100);
  }, [stages, currentStageName]);
};

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
      {showLeadingDot && <div className='rounded-full h-1 w-1 bg-gray-400'></div>}
      <TicketStatusIcon progressPercentage={25} size={12} />
      <span className={cn('text-xs line-clamp-1 break-all text-blue-500', labelClassName)}>
        {currentStageName || 'Not Started'}
      </span>
    </div>
  );
};
