import React from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { isStatusExpired, formatExpiryTime } from '../../../utils/statusUtils';
import { cn } from '../../../utils/classNames';
import { renderEmoji } from '../../../utils/customEmojiUtils';

export type StatusIndicatorSize = 'sm' | 'md' | 'lg';

interface StatusIndicatorProps {
  statusEmoji?: string | null | undefined;
  statusContent?: string | null | undefined;
  statusExpiryAt?: number | null | undefined;
  size?: StatusIndicatorSize;
  showOnHover?: boolean;
  showContent?: boolean;
  className?: string;
}

const sizeClasses: Record<StatusIndicatorSize, string> = {
  sm: 'text-xs w-4 h-4',
  md: 'text-sm w-5 h-5',
  lg: 'text-base w-6 h-6',
};

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  statusEmoji,
  statusContent,
  statusExpiryAt,
  size = 'sm',
  showOnHover = true,
  showContent = false,
  className,
}) => {
  // Check if user has a valid (non-expired) status
  const hasValidStatus = statusEmoji && (!statusExpiryAt || !isStatusExpired(statusExpiryAt));

  // Don't render anything if no valid status
  if (!hasValidStatus) {
    return null;
  }

  const sizeClass = sizeClasses[size];

  const statusIndicator = (
    <div
      className={cn(
        'inline-flex items-center justify-center gap-1',
        'flex-shrink-0',
        !showContent && sizeClass,
        className,
      )}
      title={showOnHover ? undefined : `${statusContent}`}
    >
      <span className={cn('leading-none', showContent && sizeClass)}>
        {renderEmoji(statusEmoji)}
      </span>
      {showContent && statusContent && (
        <span className='text-xs text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis'>
          {statusContent}
        </span>
      )}
    </div>
  );

  // If showOnHover is false, return just the indicator
  if (!showOnHover) {
    return statusIndicator;
  }

  return (
    <Tooltip.Provider>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{statusIndicator}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side='top'
            align='center'
            sideOffset={5}
            className='z-50 bg-popover text-popover-foreground px-3 py-2 rounded-lg shadow-lg max-w-48'
          >
            <div className='text-sm text-center'>
              <div className='font-medium text-popover-foreground break-words flex items-center justify-center gap-1'>
                {renderEmoji(statusEmoji)} {statusContent}
              </div>
              {statusExpiryAt && (
                <div className='text-xs text-muted-foreground mt-1'>
                  {formatExpiryTime(statusExpiryAt, true)}
                </div>
              )}
            </div>
            <Tooltip.Arrow className='fill-popover' />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
};
