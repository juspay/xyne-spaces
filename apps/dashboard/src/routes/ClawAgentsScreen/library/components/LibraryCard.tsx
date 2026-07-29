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

export function LibraryIconTile({
  name,
  color,
  children,
}: {
  name?: string;
  color?: string;
  children?: ReactNode;
}): ReactElement {
  return (
    <span
      className={cn(
        'flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border text-sm font-semibold',
        color ? 'border-black/5 text-white' : 'border-border bg-muted text-muted-foreground',
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
        className={cn('size-2 shrink-0 rounded-full', enabled ? 'bg-emerald-500' : 'bg-amber-500')}
      />
    </Tooltip>
  );
}

export interface LibraryCardProps {
  to: string;
  testId?: string;
  icon: ReactNode;
  name: string;
  meta?: string | undefined;
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
        'flex flex-col items-start justify-center gap-2 overflow-hidden rounded-[10px] border border-border bg-background p-3 transition-colors hover:bg-muted/40',
        dimmed && 'opacity-60',
      )}
    >
      {icon}
      <div className='flex w-full min-w-0 flex-col gap-0.5 overflow-hidden'>
        <div className='flex min-w-0 items-center gap-2'>
          {statusDot}
          <span className='truncate text-sm font-semibold leading-none text-foreground'>
            {name}
          </span>
          {meta ? (
            <span className='shrink-0 whitespace-nowrap text-xs leading-[22px] text-muted-foreground opacity-70'>
              {meta}
            </span>
          ) : null}
        </div>
        <p className='line-clamp-2 text-sm leading-5 text-muted-foreground'>
          {description || 'No description added'}
        </p>
      </div>
    </Link>
  );
}

export function LibraryCardSkeleton(): ReactElement {
  return (
    <div className='flex flex-col items-start gap-2 rounded-[10px] border border-border bg-background p-3'>
      <Skeleton className='size-10 shrink-0 rounded-lg' />
      <div className='flex w-full flex-col gap-1.5'>
        <Skeleton className='h-3.5 w-32' />
        <Skeleton className='h-3 w-full max-w-52' />
      </div>
    </div>
  );
}
