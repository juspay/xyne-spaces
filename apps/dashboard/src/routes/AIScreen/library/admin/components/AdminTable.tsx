import type { ReactElement, ReactNode } from 'react';
import { ArrowLeft, ArrowRight } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

export function AdminTable({
  headers,
  children,
}: {
  headers: readonly { label: string; align?: 'right'; width?: string }[];
  children: ReactNode;
}): ReactElement {
  return (
    <div className='min-h-0 overflow-auto rounded-xl border border-border'>
      <table className='w-max min-w-full text-sm'>
        <thead>
          <tr className='text-left text-xs uppercase tracking-wide text-muted-foreground'>
            {headers.map(header => (
              <th
                key={header.label}
                className={cn(
                  'sticky top-0 z-10 whitespace-nowrap bg-[color-mix(in_srgb,hsl(var(--muted))_50%,hsl(var(--background)))] px-4 py-2.5 shadow-[inset_0_-1px_0_hsl(var(--border))]',
                  header.align === 'right' && 'text-right',
                  header.width,
                )}
              >
                {header.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className='[&>tr:last-child]:border-b-0'>{children}</tbody>
      </table>
    </div>
  );
}

export function OrgBadge({ orgName }: { orgName: string | null | undefined }): ReactElement {
  return <Badge variant='secondary'>{orgName ?? 'Unknown org'}</Badge>;
}

export function AdminPager({
  offset,
  count,
  total,
  onPrev,
  onNext,
}: {
  offset: number;
  count: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}): ReactElement | null {
  const hasPages = offset > 0 || offset + count < total;
  if (!hasPages) return null;

  return (
    <div className='flex items-center justify-between text-xs text-muted-foreground'>
      <span>
        Showing {offset + 1}–{Math.min(offset + count, total)} of {total}
      </span>
      <div className='flex items-center gap-2'>
        <Button
          type='button'
          variant='outline'
          onClick={onPrev}
          data-track-category='Claw Admin'
          data-track-name='ADMIN_PAGER_PREV'
          disabled={offset === 0}
          className='disabled:pointer-events-auto'
        >
          <ArrowLeft className='size-4' aria-hidden />
          Prev
        </Button>
        <Button
          type='button'
          variant='outline'
          onClick={onNext}
          data-track-category='Claw Admin'
          data-track-name='ADMIN_PAGER_NEXT'
          disabled={offset + count >= total}
          className='disabled:pointer-events-auto'
        >
          Next
          <ArrowRight className='size-4' aria-hidden />
        </Button>
      </div>
    </div>
  );
}
