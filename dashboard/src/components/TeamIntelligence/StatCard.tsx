import { cn } from '@/utils/classNames';
import type { LucideIcon } from 'lucide-react';
import { ReactElement } from 'react';

interface StatCardProps {
  title: string;
  value: string | number;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  icon: LucideIcon;
  description?: string;
}

export const StatCard = ({
  title,
  value,
  change,
  changeType = 'neutral',
  icon: Icon,
  description,
}: StatCardProps): ReactElement => {
  return (
    <div
      className={cn(
        'relative overflow-hidden transition-all duration-200 rounded-xl border bg-card hover:bg-secondary/50',
      )}
    >
      <div className='p-6'>
        <div className='flex items-start justify-between'>
          <div className='space-y-2'>
            <p className='text-sm font-medium text-muted-foreground'>{title}</p>
            <p className='text-3xl font-bold tracking-tight text-foreground'>{value}</p>
            {change && (
              <p
                className={cn(
                  'text-sm font-medium',
                  changeType === 'positive' && 'text-status-success',
                  changeType === 'negative' && 'text-status-failure',
                  changeType === 'neutral' && 'text-status-new',
                )}
              >
                {change}
              </p>
            )}
            {description && <p className='text-xs font-medium text-action-accent'>{description}</p>}
          </div>
          <div className='rounded-lg bg-action-accent/10 p-3'>
            <Icon className='h-6 w-6 text-action-accent' />
          </div>
        </div>
      </div>
    </div>
  );
};
