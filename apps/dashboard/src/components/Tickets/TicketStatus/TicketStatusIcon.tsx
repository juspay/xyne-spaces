import React from 'react';
import { TicketStatusV2 } from '@xyne/shared';
import { cn } from '../../../utils/classNames';
import { getStageStatusMeta } from '../../../utils/board/stageStatusIcon';
import { StatusIndicator } from '../../Board/StatusIndicator';

interface TicketStatusWithStagesProps {
  currentStageName: string | null;
  /**
   * The ticket's status snapshot. Cards render outside any board-stage query, so
   * the indicator falls back to a status-only fill here instead of the board
   * definition's position-based one — see StageIndicator for the exact form.
   */
  statusV2?: string | null | undefined;
  showLeadingDot?: boolean;
  iconOnly?: boolean;
  className?: string;
  labelClassName?: string;
}

export const TicketStatusWithStages: React.FC<TicketStatusWithStagesProps> = ({
  currentStageName,
  statusV2,
  showLeadingDot = true,
  iconOnly = false,
  className,
  labelClassName,
}) => {
  const status = (statusV2 as TicketStatusV2) ?? TicketStatusV2.TODO;

  if (iconOnly) {
    return <StatusIndicator status={status} size={12} />;
  }
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {showLeadingDot && <div className='rounded-full h-1 w-1 bg-muted-foreground'></div>}
      <StatusIndicator status={status} size={12} />
      <span
        className={cn('text-xs line-clamp-1 break-all', labelClassName)}
        style={{ color: getStageStatusMeta(statusV2).cssVar }}
      >
        {currentStageName || 'Not Started'}
      </span>
    </div>
  );
};
