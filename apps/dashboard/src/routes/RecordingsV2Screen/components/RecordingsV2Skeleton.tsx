import type { ReactElement } from 'react';
import { Skeleton } from '../../../components/ui/Skeleton';
import { cn } from '../../../utils/classNames';

const SKELETON_GROUPS = [
  {
    id: 'group-1',
    labelWidth: 'w-12',
    rows: [
      { id: 'recording-1', titleWidth: 'w-56', metadataWidth: 'w-36' },
      { id: 'recording-2', titleWidth: 'w-44', metadataWidth: 'w-44' },
      { id: 'recording-3', titleWidth: 'w-64', metadataWidth: 'w-40' },
      { id: 'recording-4', titleWidth: 'w-48', metadataWidth: 'w-32' },
    ],
  },
  {
    id: 'group-2',
    labelWidth: 'w-16',
    rows: [
      { id: 'recording-5', titleWidth: 'w-48', metadataWidth: 'w-40' },
      { id: 'recording-6', titleWidth: 'w-64', metadataWidth: 'w-32' },
      { id: 'recording-7', titleWidth: 'w-52', metadataWidth: 'w-44' },
    ],
  },
  {
    id: 'group-3',
    labelWidth: 'w-20',
    rows: [
      { id: 'recording-8', titleWidth: 'w-52', metadataWidth: 'w-36' },
      { id: 'recording-9', titleWidth: 'w-40', metadataWidth: 'w-48' },
      { id: 'recording-10', titleWidth: 'w-40', metadataWidth: 'w-48' },
      { id: 'recording-11', titleWidth: 'w-40', metadataWidth: 'w-48' },
      { id: 'recording-12', titleWidth: 'w-40', metadataWidth: 'w-48' },
    ],
  },
] as const;

export function RecordingsV2Skeleton(): ReactElement {
  return (
    <div
      className='flex flex-col pb-6'
      role='status'
      aria-live='polite'
      aria-busy='true'
      aria-label='Loading recordings'
    >
      <span className='sr-only'>Loading recordings</span>

      <div aria-hidden='true'>
        {SKELETON_GROUPS.map(group => (
          <section key={group.id}>
            <div className='py-2'>
              <Skeleton className={cn('h-3', group.labelWidth)} />
            </div>

            {group.rows.map(row => (
              <div key={row.id} className='flex w-full items-start gap-3 rounded-xl px-3 py-3'>
                <div className='relative mt-0.5 shrink-0'>
                  <Skeleton className='size-11 rounded-xl' />
                  <span className='absolute -bottom-1 -right-1 size-5 animate-pulse rounded-full bg-muted ring-2 ring-background' />
                </div>

                <div className='flex min-w-0 flex-1 items-start justify-between gap-4'>
                  <div className='min-w-0 flex-1'>
                    <Skeleton className={cn('h-3.5 max-w-full', row.titleWidth)} />
                    <Skeleton className={cn('mt-2 h-3 max-w-full', row.metadataWidth)} />
                  </div>

                  <Skeleton className='h-3 w-12 shrink-0' />
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
