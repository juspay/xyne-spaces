import { ReactElement } from 'react';
import { Loader2, X } from './icons';
import { Button } from '@/components/ui/Button';
import { useClawDigitalTwinMemories } from '@/hooks/useClawDigitalTwin';
import { MemoryCard } from './MemoryCard';
import { subsystemLabel } from './subsystems';

export const SubsystemMemoriesPanel = ({
  subsystem,
  onClose,
}: {
  subsystem: string;
  onClose: () => void;
}): ReactElement => {
  const query = useClawDigitalTwinMemories({ limit: 50, subsystem });
  const memories = query.data?.memories ?? [];

  return (
    <aside className='dt-paper-raised flex h-full max-h-[720px] flex-col border-y dt-rule'>
      <div className='flex items-start gap-3 border-b dt-rule px-4 py-4'>
        <div className='min-w-0 flex-1'>
          <p className='dt-muted text-sm'>Knowledge area</p>
          <h3 className='dt-display mt-1 text-xl font-semibold text-[var(--dt-ink)]'>
            {subsystemLabel(subsystem)}
          </h3>
          {query.data && (
            <p className='dt-muted mt-1 text-sm tabular-nums'>
              {query.data.total} memor{query.data.total === 1 ? 'y' : 'ies'}
            </p>
          )}
        </div>
        <button
          type='button'
          onClick={onClose}
          data-track-category='Claw Agents'
          data-track-name='Digital Twin close knowledge area'
          aria-label='Close knowledge-area details'
          className='dt-control dt-transition flex size-11 items-center justify-center rounded-lg text-[var(--dt-muted)] hover:bg-[var(--dt-paper)] hover:text-[var(--dt-ink)]'
        >
          <X className='size-5' />
        </button>
      </div>
      <div className='dt-memory-list min-h-0 flex-1 overflow-y-auto px-4 pb-4'>
        {query.isLoading && (
          <div className='flex min-h-32 items-center gap-2 text-sm text-[var(--dt-muted)]'>
            <Loader2 className='size-4 animate-spin' />
            Loading memories…
          </div>
        )}
        {query.isError && (
          <div
            role='alert'
            className='my-4 border border-[var(--dt-danger)] bg-[var(--dt-danger-soft)] p-4'
          >
            <p className='font-semibold text-[var(--dt-danger)]'>Memories did not load.</p>
            <Button
              variant='outline'
              className='dt-control mt-3'
              onClick={() => void query.refetch()}
            >
              Try again
            </Button>
          </div>
        )}
        {!query.isLoading && !query.isError && memories.length === 0 && (
          <p className='dt-muted py-8 text-sm'>No memories are tagged with this knowledge area.</p>
        )}
        {memories.map((memory, index) => (
          <MemoryCard
            key={memory.hindsightMemoryId}
            memory={memory}
            expansionAnchor={index === 0 ? 'top' : 'bottom'}
          />
        ))}
      </div>
    </aside>
  );
};
