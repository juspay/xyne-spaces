import React from 'react';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { cn } from '../../utils/classNames';

interface KPICardProps {
  title: string;
  value: string | number;
  unit?: string;
  trend?: {
    value: number;
    direction: 'up' | 'down' | 'neutral';
    label: string;
  };
  icon?: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  queryLabel?: string;
}

const accentColors = {
  primary: {
    bg: 'bg-blue-500',
    ring: 'ring-blue-500/20',
    text: 'text-blue-600 dark:text-blue-400',
  },
  secondary: {
    bg: 'bg-purple-500',
    ring: 'ring-purple-500/20',
    text: 'text-purple-600 dark:text-purple-400',
  },
  success: {
    bg: 'bg-emerald-500',
    ring: 'ring-emerald-500/20',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  warning: {
    bg: 'bg-amber-500',
    ring: 'ring-amber-500/20',
    text: 'text-amber-600 dark:text-amber-400',
  },
  danger: { bg: 'bg-red-500', ring: 'ring-red-500/20', text: 'text-red-600 dark:text-red-400' },
};

export const KPICard: React.FC<KPICardProps> = ({
  title,
  value,
  unit,
  trend,
  variant = 'primary',
  className,
}) => {
  const accent = accentColors[variant];

  return (
    <div
      className={cn(
        'rounded-xl border border-border/40 bg-gradient-to-br from-background to-background/95 overflow-hidden',
        'shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105',
        'backdrop-blur-sm',
        className,
      )}
    >
      <div className='flex items-stretch'>
        {/* Accent bar - gradient */}
        <div className={cn('w-1.5 shrink-0 bg-gradient-to-b', accent.bg)} />

        <div className='flex-1 px-5 py-4'>
          {/* Title row */}
          <p className='text-xs font-bold text-muted-foreground/70 mb-1.5 uppercase tracking-wider'>
            {title}
          </p>

          {/* Value row */}
          <div className='flex items-baseline gap-2 flex-wrap'>
            <span className='text-3xl font-black bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-transparent tracking-tight'>
              {value}
            </span>
            {unit && <span className='text-xs font-semibold text-muted-foreground'>{unit}</span>}
            {trend && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 text-xs font-bold ml-auto px-2.5 py-1 rounded-full',
                  trend.direction === 'up'
                    ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                    : trend.direction === 'down'
                      ? 'bg-red-500/20 text-red-600 dark:text-red-400'
                      : 'bg-muted/40 text-muted-foreground',
                )}
              >
                {trend.direction === 'up' && <ArrowUp className='w-3 h-3' />}
                {trend.direction === 'down' && <ArrowDown className='w-3 h-3' />}
                {trend.direction === 'neutral' && <Minus className='w-3 h-3' />}
                <span>
                  {trend.value > 0 ? '+' : ''}
                  {trend.value}%
                </span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const getKPIPreview = (): Record<string, unknown>[] => [{ value: 1234 }];

export default KPICard;
