import { Wrench } from 'lucide-react';
import React from 'react';

interface SupportChannelBadgeProps {
  className?: string;
}

/**
 * Badge to indicate a support channel
 */
export const SupportChannelBadge: React.FC<SupportChannelBadgeProps> = ({ className = '' }) => {
  return (
    <div
      className={`flex items-center gap-1 text-xs bg-muted text-primary px-2 py-1 rounded-full font-medium ${className}`}
      title='AI Support enabled - Automated responses for common queries'
    >
      <Wrench className='w-4 h-4' />
    </div>
  );
};
