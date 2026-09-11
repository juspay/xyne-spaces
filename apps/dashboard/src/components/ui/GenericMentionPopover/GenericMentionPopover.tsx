import React, { useState, useEffect } from 'react';
import { HoverCard } from '../HoverCard/HoverCard';

export interface GenericMentionData {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  description?: string;
  meta?: string | React.ReactNode;
}

interface GenericMentionHoverPopoverProps {
  data: GenericMentionData;
  children: React.ReactNode;
  onClick?: () => void;
}

export const GenericMentionHoverPopover: React.FC<GenericMentionHoverPopoverProps> = ({
  data,
  children,
  onClick,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  // Close hover card on scroll
  useEffect(() => {
    if (!isOpen) return;
    const handleScroll = (): void => setIsOpen(false);
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [isOpen]);

  const trigger = onClick ? (
    <span
      role='button'
      tabIndex={0}
      onClick={onClick}
      data-track-category='MENTION'
      data-track-name='OPEN_MENTION'
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      style={{ cursor: 'pointer' }}
    >
      {children}
    </span>
  ) : (
    <span>{children}</span>
  );

  return (
    <HoverCard
      trigger={trigger}
      side='top'
      align='start'
      openDelay={400}
      closeDelay={200}
      open={isOpen}
      onOpenChange={setIsOpen}
      className='min-w-[300px] bg-transparent p-0 border-0 shadow-none'
    >
      <div className='bg-popover rounded-lg shadow-lg min-w-[300px] border border-border'>
        <div className='p-4'>
          {/* Title row */}
          <div className='flex items-center gap-2 mb-2'>
            {data.icon && <span className='text-lg'>{data.icon}</span>}
            <div className='font-semibold text-foreground'>{data.title}</div>
          </div>

          {data.subtitle && (
            <div className='text-sm text-muted-foreground mb-1 break-words'>{data.subtitle}</div>
          )}

          {data.description && (
            <div className='text-sm text-foreground mb-3 break-words'>{data.description}</div>
          )}

          {data.meta && <div className='text-xs text-muted-foreground'>{data.meta}</div>}
        </div>
      </div>
    </HoverCard>
  );
};
