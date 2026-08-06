import { useState, type ReactElement, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { TabMessage } from './TabMessage';

export interface ApprovalItem {
  id: string;
  title: string;
  subtitle?: ReactNode;
  meta?: ReactNode;
}

export function ApprovalQueue({
  items,
  isPending,
  isError,
  errorText,
  emptyText,
  busy,
  onApprove,
  onReject,
}: {
  items: ApprovalItem[] | undefined;
  isPending: boolean;
  isError: boolean;
  errorText: string;
  emptyText: string;
  busy: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string, note: string | undefined) => void;
}): ReactElement {
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  if (isPending) return <Skeleton className='h-24 w-full' />;
  if (isError) return <TabMessage>{errorText}</TabMessage>;
  if (!items || items.length === 0) return <TabMessage>{emptyText}</TabMessage>;

  return (
    <ul className='flex flex-col gap-2 pt-4'>
      {items.map(item => (
        <li key={item.id} className='rounded-xl border border-border p-4'>
          <div className='flex flex-wrap items-start justify-between gap-3'>
            <div className='min-w-0'>
              <p className='truncate text-sm font-medium text-foreground'>{item.title}</p>
              {item.subtitle && (
                <p className='truncate text-sm text-muted-foreground'>{item.subtitle}</p>
              )}
              {item.meta && <div className='mt-1 text-xs text-muted-foreground'>{item.meta}</div>}
            </div>
            <div className='flex shrink-0 items-center gap-2'>
              <Button
                type='button'
                variant='outline'
                onClick={() => {
                  setNote('');
                  setRejectingId(prev => (prev === item.id ? null : item.id));
                }}
                disabled={busy}
                data-track-category='Claw Admin'
                data-track-name='Reject'
              >
                Reject
              </Button>
              <Button
                type='button'
                onClick={() => onApprove(item.id)}
                disabled={busy}
                data-track-category='Claw Admin'
                data-track-name='Approve'
              >
                Approve
              </Button>
            </div>
          </div>

          {rejectingId === item.id && (
            <div className='mt-3 flex flex-wrap items-center gap-2'>
              <Input
                value={note}
                onChange={event => setNote(event.target.value)}
                placeholder='Reason (optional)'
                className='min-w-0 flex-1'
                aria-label='Rejection reason'
              />
              <Button
                type='button'
                variant='outline'
                onClick={() => {
                  onReject(item.id, note.trim() || undefined);
                  setRejectingId(null);
                  setNote('');
                }}
                disabled={busy}
              >
                Confirm reject
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
