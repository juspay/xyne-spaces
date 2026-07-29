import { cn } from '@/utils/classNames';
import type { LucideIcon } from 'lucide-react';
import { ReactElement } from 'react';
import CountUp from '../ui/CountUp/CountUp';

interface StatCardProps {
  title: string;
  value: string | number;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  icon: LucideIcon;
  description?: string;
  isLoading?: boolean;
}

export const StatCard = ({
  title,
  value,
  change,
  changeType = 'neutral',
  icon: Icon,
  description,
  isLoading = false,
}: StatCardProps): ReactElement => {
  const isNumeric = typeof value === 'number' || !isNaN(Number(value));
  const numericValue = typeof value === 'number' ? value : parseFloat(value.toString());

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
            <div>
              {isLoading ? (
                <div className='h-8 w-36 rounded-md animate-pulse bg-muted-foreground/10' />
              ) : isNumeric ? (
                <CountUp
                  to={numericValue}
                  className='text-3xl font-bold tracking-tight text-foreground font-mono'
                  duration={0.5}
                />
              ) : (
                <p className='text-3xl font-bold tracking-tight text-foreground font-mono'>
                  {value}
                </p>
              )}
            </div>

            <>
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
              {description && (
                <p className='text-xs font-medium text-action-accent'>{description}</p>
              )}
            </>
          </div>
          <div className='rounded-lg bg-action-accent/10 p-3'>
            <Icon className='h-6 w-6 text-action-accent' />
          </div>
        </div>
      </div>
    </div>
  );
};
