import React, { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Pencil, X, Smile } from 'lucide-react';
import Avatar from '../ui/Avatar/Avatar';
import { StatusIndicator } from '../ui/StatusIndicator';
import { Button } from '../ui/Button/Button';
import { UpdateStatusModal } from './UpdateStatusModal';
import { useUser } from '../../hooks/useUsers';
import { isStatusExpired, formatExpiryTime } from '../../utils/statusUtils';

interface AvatarPopoverProps {
  userId: string;
}

export const AvatarPopover: React.FC<AvatarPopoverProps> = ({ userId }) => {
  const user = useUser(userId);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Get status fields directly from user (promoted from user_presence)
  const statusEmoji = user?.statusEmoji;
  const statusContent = user?.statusContent;
  const statusExpiryAt = user?.statusExpiryAt;

  const hasStatus = statusEmoji && (!statusExpiryAt || !isStatusExpired(statusExpiryAt));

  const handleClearStatus = (e: React.MouseEvent): void => {
    e.stopPropagation();
    setIsPopoverOpen(false);
  };

  const handleStatusAreaClick = (): void => {
    setIsModalOpen(true);
    setIsPopoverOpen(false);
    setIsHovered(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleStatusAreaClick();
    }
  };

  return (
    <>
      <Popover.Root open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <Popover.Trigger asChild>
          <Button
            variant='ghost'
            className='focus:outline-none flex flex-col items-center gap-1 p-0 h-auto'
          >
            {hasStatus && (
              <div className='h-4 flex items-center justify-center bg-muted rounded-full px-2 min-w-[16px]'>
                <StatusIndicator
                  statusEmoji={user?.statusEmoji}
                  statusContent={user?.statusContent}
                  statusExpiryAt={user?.statusExpiryAt}
                  size='sm'
                />
              </div>
            )}
            <Avatar userId={userId} size='md' />
          </Button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            side='right'
            align='end'
            sideOffset={8}
            className='bg-background rounded-lg shadow-lg border border-border p-3 w-80 z-50'
          >
            {/* Single Interactive Area */}
            {hasStatus ? (
              <div
                role='button'
                tabIndex={0}
                className='group cursor-pointer'
                onClick={handleStatusAreaClick}
                onKeyDown={handleKeyDown}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                data-track-category='App_Sidebar_Avatar_Popover'
                data-track-name='Edit_Status'
                data-track-metadata={JSON.stringify({ hasStatus: true, statusContent })}
              >
                <div className='flex items-center gap-2 p-2 rounded-lg hover:bg-muted transition-colors'>
                  <div className='text-xl mt-0.5'>
                    {isHovered ? <Pencil className='size-5 text-muted-foreground' /> : statusEmoji}
                  </div>
                  <div className='flex-1 min-w-0'>
                    <p className='text-sm font-medium text-foreground break-words'>
                      {statusContent}
                    </p>
                    {statusExpiryAt && (
                      <p className='text-xs text-muted-foreground mt-1'>
                        {formatExpiryTime(statusExpiryAt, true)}
                      </p>
                    )}
                  </div>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={handleClearStatus}
                    className='flex-shrink-0 p-1 h-auto'
                    title='Clear status'
                    data-track-category='App_Sidebar_Avatar_Popover'
                    data-track-name='Clear_Status'
                    data-track-metadata={JSON.stringify({ statusContent })}
                  >
                    <X className='size-4 text-muted-foreground' />
                  </Button>
                </div>
              </div>
            ) : (
              <div
                role='button'
                tabIndex={0}
                className='cursor-pointer p-2 rounded-lg hover:bg-muted transition-colors'
                onClick={handleStatusAreaClick}
                onKeyDown={handleKeyDown}
                data-track-category='App_Sidebar_Avatar_Popover'
                data-track-name='Set_Status'
                data-track-metadata={JSON.stringify({ hasStatus: false })}
              >
                <div className='flex items-center gap-2'>
                  <Smile className='size-5 text-muted-foreground' />
                  <span className='text-sm text-muted-foreground' data-testid='set-status-btn'>
                    Update your status
                  </span>
                </div>
              </div>
            )}

            <Popover.Arrow className='fill-white' />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {/* Status Update Modal */}
      <UpdateStatusModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        currentStatus={
          hasStatus
            ? {
                emoji: statusEmoji || '',
                content: statusContent || '',
                expiryAt: statusExpiryAt || null,
              }
            : null
        }
      />
    </>
  );
};
