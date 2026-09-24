import { ReactElement } from 'react';
import { Skeleton } from '../../../ui/Skeleton';
import { cn } from '../../../../utils/classNames';

const SKELETON_ROWS = [
  { avatar: true, lines: ['w-1/3', 'w-11/12', 'w-2/3'] },
  { avatar: true, lines: ['w-1/4', 'w-5/6'] },
  { avatar: true, lines: ['w-2/5', 'w-10/12', 'w-1/2'] },
  { avatar: true, lines: ['w-1/3', 'w-3/4'] },
] as const;

/**
 * What a column shows while its surface is still being built.
 *
 * Instant, for the same reason the surface is: a placeholder that fades in
 * leaves the column blank for the frames it takes to arrive, which is the thing
 * it exists to prevent.
 *
 * Its own module rather than a private const in `StreamColumn`, because the
 * surface a column builds needs it too. A chat panel shows its own centred
 * spinner while its first page loads, and that lands *after* this skeleton has
 * already been replaced — so the column went skeleton, spinner, content, and
 * the middle state read as a blink. Handing the same skeleton down as the
 * panel's loading state makes the two indistinguishable, so the column holds
 * one placeholder from mount until the messages arrive. `StreamColumn` imports
 * `surfaceFor` from `Surfaces`, so this cannot live in either of them without
 * making that a cycle.
 */
export const ColumnSkeleton = (): ReactElement => (
  <div className='flex h-full flex-col gap-5 px-3 pt-4' aria-hidden>
    {SKELETON_ROWS.map((row, index) => (
      <div key={index} className='flex gap-2'>
        {row.avatar && <Skeleton className='size-7 shrink-0 rounded-full opacity-60' />}
        <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
          {row.lines.map((width, line) => (
            <Skeleton key={line} className={cn('h-3 opacity-60', width)} />
          ))}
        </div>
      </div>
    ))}
  </div>
);
