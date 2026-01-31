import React from 'react';
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
  const trigger = onClick ? (
    <span
      role='button'
      tabIndex={0}
      onClick={onClick}
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
      className='min-w-[300px] bg-transparent p-0 border-0 shadow-none'
    >
      <div className='bg-white rounded-lg shadow-lg min-w-[300px] border border-gray-200'>
        <div className='p-4'>
          {/* Title row */}
          <div className='flex items-center gap-2 mb-2'>
            {data.icon && <span className='text-lg'>{data.icon}</span>}
            <div className='font-semibold text-gray-900'>{data.title}</div>
          </div>

          {data.subtitle && <div className='text-sm text-gray-600 mb-1'>{data.subtitle}</div>}

          {data.description && <div className='text-sm text-gray-700 mb-3'>{data.description}</div>}

          {data.meta && <div className='text-xs text-gray-500'>{data.meta}</div>}
        </div>
      </div>
    </HoverCard>
  );
};
