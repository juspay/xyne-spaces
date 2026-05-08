import React from 'react';
import { Loader2, CheckCircle2, XCircle, Upload } from 'lucide-react';
import { UploadStatus } from '../../../services/Knowledge/collectionService';
import Tooltip from '../../ui/Tooltip';

interface UploadStatusBadgeProps {
  status: UploadStatus;
  /** Display variant: 'compact' (icon only, circular) or 'pill' (icon + label, pill-shaped) */
  variant?: 'compact' | 'pill';
}

/**
 * Unified status badge component for upload/processing status
 * Can be used in file cards (compact) or tree nodes (pill)
 */
export const UploadStatusBadge: React.FC<UploadStatusBadgeProps> = ({
  status,
  variant = 'compact',
}) => {
  const statusConfig: Record<
    UploadStatus,
    {
      icon: React.ElementType;
      color: string;
      bg: string;
      label: string;
      animate?: boolean;
    }
  > = {
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

  // Handle invalid or undefined status
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

  // Compact variant (circular, icon only)
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
