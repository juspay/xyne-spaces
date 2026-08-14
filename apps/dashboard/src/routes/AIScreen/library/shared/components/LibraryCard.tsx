import { type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/utils/classNames';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';

const getInitials = (name: string): string => {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};
const TILE_SIZE = { sm: 'size-8', md: 'size-10' } as const;

export function LibraryIconTile({
  name,
  color,
  size = 'sm',
  children,
}: {
  name?: string;
  color?: string;
  size?: keyof typeof TILE_SIZE;
  children?: ReactNode;
}): ReactElement {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-lg text-sm font-medium shadow-sm',
        TILE_SIZE[size],

        color ? 'text-white' : 'border border-border bg-card text-muted-foreground',
      )}
      style={color ? { backgroundColor: color } : undefined}
      aria-hidden='true'
    >
      {children ?? (name ? getInitials(name) : null)}
    </span>
  );
}

export function LibraryStatusDot({
  enabled,
  enabledLabel,
  disabledLabel,
}: {
  enabled: boolean;
  enabledLabel: string;
  disabledLabel: string;
}): ReactElement {
  return (
    <Tooltip side='top' content={enabled ? enabledLabel : disabledLabel}>
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          enabled ? 'bg-emerald-500' : 'bg-amber-500',
        )}
      />
    </Tooltip>
  );
}

export interface LibraryCardProps {
  to: string;
  testId?: string;
  icon: ReactNode;
  name: string;
  meta?: ReactNode | string | undefined;
  statusDot?: ReactNode;
  description?: string | undefined;
  dimmed?: boolean;
}

export function LibraryCard({
  to,
  testId,
  icon,
  name,
  meta,
  statusDot,
  description,
  dimmed = false,
}: LibraryCardProps): ReactElement {
  return (
    <Link
      to={to}
      data-testid={testId}
      className={cn(
        'flex items-start gap-3 overflow-hidden rounded-[20px] border border-border bg-background p-4 transition-colors hover:bg-muted/40',
        dimmed && 'opacity-60',
      )}
    >
      {icon}
      <div className='flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden'>
        <div className='flex min-w-0 items-center gap-2'>
          <span className='truncate text-sm font-medium leading-[22px] text-foreground'>
            {name}
          </span>
          {meta ? (
            typeof meta === 'string' ? (
              <span className='shrink-0 whitespace-nowrap text-xs leading-[22px] text-foreground/80 opacity-70'>
                {meta}
              </span>
            ) : (
              meta
            )
          ) : null}
          {statusDot}
        </div>
        <p className='truncate text-sm leading-5 text-foreground/60'>
          {description || 'No description added'}
        </p>
      </div>
    </Link>
  );
}

export function LibraryCardSkeleton(): ReactElement {
  return (
    <div className='flex items-start gap-3 rounded-[20px] border border-border bg-background p-4'>
      <Skeleton className='size-8 shrink-0 rounded-lg' />

      <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
        <div className='flex min-h-[22px] items-center'>
          <Skeleton className='h-3.5 w-32' />
        </div>
        <div className='flex h-5 items-center'>
          <Skeleton className='h-3 w-full max-w-52' />
        </div>
      </div>
    </div>
  );
}
