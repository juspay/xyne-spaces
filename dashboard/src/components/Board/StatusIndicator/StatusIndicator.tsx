import type { ReactElement } from 'react';
import { TicketStatusV2 } from '@xyne/shared';
import type { StatusIndicatorProps } from './StatusIndicator.types';

export const StatusIndicator = ({
  status,
  size = 16,
  stageIndex,
  totalNonCancelledStages,
}: StatusIndicatorProps): ReactElement => {
  // Define color and ring color based on status
  const getStatusConfig = (s: TicketStatusV2): { color: string; ringColor: string } => {
    switch (s) {
      case TicketStatusV2.TODO:
        return { color: '#9CA3AF', ringColor: '#9CA3AF' }; // Gray
      case TicketStatusV2.STARTED:
        return { color: '#3B82F6', ringColor: '#3B82F6' }; // Blue
      case TicketStatusV2.PAUSED:
        return { color: '#EAB308', ringColor: '#EAB308' }; // Yellow
      case TicketStatusV2.COMPLETED:
        return { color: '#22C55E', ringColor: '#22C55E' }; // Green
      case TicketStatusV2.CANCELLED:
        return { color: '#EF4444', ringColor: '#EF4444' }; // Red
      default:
        return { color: '#9CA3AF', ringColor: '#9CA3AF' };
    }
  };

  // Calculate fill percentage based on stage position
  const getFillPercent = (): number => {
    // If cancelled, always 100% but red
    if (status === TicketStatusV2.CANCELLED) return 100;

    // If todo, always 0%
    if (status === TicketStatusV2.TODO) return 0;

    // If completed, always 100%
    if (status === TicketStatusV2.COMPLETED) return 100;

    // If we have stage info, calculate based on position (for STARTED/PAUSED only)
    if (stageIndex !== undefined && totalNonCancelledStages && totalNonCancelledStages > 0) {
      return ((stageIndex + 1) / totalNonCancelledStages) * 100;
    }

    // Fallback to status-based fill
    switch (status) {
      case TicketStatusV2.STARTED:
        return 33;
      case TicketStatusV2.PAUSED:
        return 66;
      default:
        return 0;
    }
  };

  const config = getStatusConfig(status);
  const fillPercent = getFillPercent();
  const center = size / 2;
  const ringRadius = (size - 3) / 2;
  const fillRadius = ringRadius - 2; // 2px gap between ring and fill

  // Calculate pie slice path for fill
  const getPiePath = (percent: number): string => {
    if (percent === 0) return '';
    if (percent === 100) {
      return `M ${center} ${center} m -${fillRadius} 0 a ${fillRadius} ${fillRadius} 0 1 0 ${fillRadius * 2} 0 a ${fillRadius} ${fillRadius} 0 1 0 -${fillRadius * 2} 0`;
    }

    const angle = (percent / 100) * 360 - 90; // Start from top
    const radians = (angle * Math.PI) / 180;
    const x = center + fillRadius * Math.cos(radians);
    const y = center + fillRadius * Math.sin(radians);
    const largeArc = percent > 50 ? 1 : 0;

    return `M ${center} ${center} L ${center} ${center - fillRadius} A ${fillRadius} ${fillRadius} 0 ${largeArc} 1 ${x} ${y} Z`;
  };

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Outer ring - fits within bounds */}
      <circle
        cx={center}
        cy={center}
        r={ringRadius}
        fill='none'
        stroke={config.ringColor}
        strokeWidth={1.5}
      />
      {/* Inner fill (pie slice) */}
      {fillPercent > 0 && (
        <path
          d={getPiePath(fillPercent)}
          fill={config.color}
          style={{ transition: 'all 0.3s ease' }}
        />
      )}
    </svg>
  );
};

export default StatusIndicator;
