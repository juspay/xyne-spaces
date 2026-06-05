import React from 'react';
import { Loader2, CheckCircle2, XCircle, Upload } from 'lucide-react';
import { IngestionStatus } from '@xyne/shared';
import Tooltip from '../../ui/Tooltip';

interface IngestionStatusBadgeProps {
  status: IngestionStatus | null;
  variant?: 'compact' | 'pill';
}

export const IngestionStatusBadge: React.FC<IngestionStatusBadgeProps> = ({
  status,
  variant = 'compact',
}) => {
  const statusConfig: Record<
    IngestionStatus,
    {
      icon: React.ElementType;
      color: string;
      bg: string;
      label: string;
      animate?: boolean;
    }
  > = {
    NONE: {
      icon: Upload,
      color: 'text-gray-400',
      bg: 'bg-gray-50',
      label: 'Not started',
    },
    PENDING: {
      icon: Upload,
      color: 'text-blue-500',
      bg: 'bg-blue-50',
      label: 'Pending',
    },
    PROCESSING: {
      icon: Loader2,
      color: 'text-yellow-500',
      bg: 'bg-yellow-50',
      label: 'Processing',
      animate: true,
    },
    COMPLETED: {
      icon: CheckCircle2,
      color: 'text-green-500',
      bg: 'bg-green-50',
      label: 'Completed',
    },
    FAILED: {
      icon: XCircle,
      color: 'text-red-500',
      bg: 'bg-red-50',
      label: 'Failed',
    },
  };

  if (!status || !statusConfig[status]) {
    return null;
  }

  const config = statusConfig[status];
  const Icon = config.icon;

  if (variant === 'pill') {
    return (
      <Tooltip content={config.label} side='top'>
        <span
          className={`
            flex items-center gap-1 px-1.5 py-0.5 rounded text-xs
            ${config.color} ${config.bg}
          `}
        >
          <Icon size={12} className={config.animate ? 'animate-spin' : ''} />
          <span className='hidden sm:inline'>{config.label}</span>
        </span>
      </Tooltip>
    );
  }

  return (
    <Tooltip content={config.label} side='top'>
      <span
        className={`
          flex items-center justify-center w-6 h-6 rounded-full
          ${config.color} ${config.bg}
        `}
      >
        <Icon size={14} className={config.animate ? 'animate-spin' : ''} />
      </span>
    </Tooltip>
  );
};
