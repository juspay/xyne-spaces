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
const TILE_SIZE = {
  sm: 'size-8 rounded-lg',
  md: 'size-10 rounded-lg',
  // The 44px tile on Agent Hub's flat cards (Figma 1338:41838).
  lg: 'size-11 rounded-xl',
} as const;

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
        'flex shrink-0 items-center justify-center overflow-hidden text-sm font-medium shadow-sm',
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
  /**
   * Replaces the description line when a tab needs more than text there — the
   * apps tab puts an avatar and the creator's name on it. A slot rather than
   * widening `description` to ReactNode: the description renders inside a <p>
   * with truncation, which is wrong markup for an element containing an avatar.
   */
  footer?: ReactNode;
  dimmed?: boolean;
  /** Borderless card that only tints on hover (Figma 1959:34563, 1338:41838). */
  variant?: 'outlined' | 'flat';
  /** Flat only: green tint and border, for items you already have (a connected MCP). */
  highlighted?: boolean;
}

export function LibraryCard({
  to,
  testId,
  icon,
  name,
  meta,
  statusDot,
  description,
  footer,
  dimmed = false,
  variant = 'outlined',
  highlighted = false,
}: LibraryCardProps): ReactElement {
  const flat = variant === 'flat';
  return (
    <Link
      to={to}
      data-testid={testId}
      className={cn(
        'flex overflow-hidden transition-colors',
        flat
          ? // p-[11px] + a 1px border keeps every flat card 12px in, tinted or not.
            cn(
              'items-center gap-2 rounded-2xl border p-[11px]',
              highlighted
                ? 'border-[color-mix(in_srgb,var(--status-success)_20%,transparent)] bg-[color-mix(in_srgb,var(--status-success)_4%,transparent)] hover:bg-[color-mix(in_srgb,var(--status-success)_8%,transparent)]'
                : 'border-transparent hover:bg-foreground/[0.04]',
            )
          : 'items-start gap-3 rounded-[20px] border border-border bg-background p-4 hover:bg-muted/40',
        dimmed && 'opacity-60',
      )}
    >
      {icon}
      <div className='flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden'>
        <div className='flex min-w-0 items-center gap-2'>
          <span
            className={cn(
              'truncate text-sm text-foreground',
              flat ? 'font-[550] leading-5' : 'font-medium leading-[22px]',
            )}
          >
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
        {footer ?? (
          <p
            className={cn(
              'truncate leading-5',
              flat
                ? 'text-xs font-normal tracking-[-0.24px] text-muted-foreground'
                : 'text-sm text-foreground/60',
            )}
          >
            {description || 'No description added'}
          </p>
        )}
      </div>
    </Link>
  );
}

export function LibraryCardSkeleton({
  variant = 'outlined',
}: {
  variant?: LibraryCardProps['variant'];
}): ReactElement {
  const flat = variant === 'flat';
  return (
    <div
      className={cn(
        'flex',
        flat
          ? 'items-center gap-2 p-3'
          : 'items-start gap-3 rounded-[20px] border border-border bg-background p-4',
      )}
    >
      <Skeleton className={cn('shrink-0', flat ? 'size-11 rounded-xl' : 'size-8 rounded-lg')} />

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
