import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/utils/classNames';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';

export function AdminTable({
  headers,
  children,
}: {
  headers: readonly { label: string; align?: 'right' }[];
  children: ReactNode;
}): ReactElement {
  return (
    <div className='overflow-x-auto rounded-xl border border-border'>
      <table className='w-full text-sm'>
        <thead>
          <tr className='border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground'>
            {headers.map(header => (
              <th
                key={header.label}
                className={cn('px-3 py-2 font-medium', header.align === 'right' && 'text-right')}
              >
                {header.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
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
}): ReactElement {
  return (
    <div className='flex items-center justify-between text-xs text-muted-foreground'>
      <span>
        Showing {offset + 1}–{Math.min(offset + count, total)} of {total}
      </span>
      <div className='flex items-center gap-2'>
        <Button type='button' variant='outline' onClick={onPrev} disabled={offset === 0}>
          Prev
        </Button>
        <Button type='button' variant='outline' onClick={onNext} disabled={offset + count >= total}>
          Next
        </Button>
      </div>
    </div>
  );
}
