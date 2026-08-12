import { ReactElement, useState } from 'react';
import { Flame, RefreshCw } from '@/components/ClawAgents/digitalTwin/icons';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import { useClawDigitalTwinStats, useDeleteDigitalTwinMemory } from '@/hooks/useClawDigitalTwin';
import { MemoryCard } from '@/components/ClawAgents/digitalTwin/MemoryCard';
import type { MemoryBankMemory, MemoryRange } from '@/services/claw/digitalTwinTypes';

const RANGES: Array<{ value: MemoryRange; label: string }> = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

const DigitalTwinHotTab = (): ReactElement => {
  const [range, setRange] = useState<MemoryRange>('7d');
  const statsQuery = useClawDigitalTwinStats(range);
  const deleteMutation = useDeleteDigitalTwinMemory();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const hot = statsQuery.data?.hot ?? [];
  const rangeLabel = RANGES.find(option => option.value === range)?.label.toLowerCase() ?? range;

  return (
    <div className='flex flex-col gap-7'>
      <div className='grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end'>
        <div>
          <p className='dt-accent text-sm font-bold'>Inspect · Most recalled</p>
          <h2 className='dt-display mt-1 text-2xl font-semibold text-[var(--dt-ink)]'>
            Knowledge the Twin reaches for
          </h2>
          <p className='dt-muted mt-2 max-w-[68ch] text-base'>
            Recall frequency reveals which memories are doing the most work in grounded replies.
          </p>
        </div>
        <div className='flex items-center rounded-lg border dt-rule p-1' aria-label='Recall range'>
          {RANGES.map(option => (
            <button
              key={option.value}
              type='button'
              onClick={() => setRange(option.value)}
              aria-pressed={range === option.value}
              data-track-category='Claw Agents'
              data-track-name='Digital Twin change recall range'
              className={
                range === option.value
                  ? 'dt-control dt-transition rounded-md bg-[var(--dt-ink)] px-4 text-sm font-semibold text-[var(--dt-paper)]'
                  : 'dt-control dt-transition rounded-md px-4 text-sm font-semibold text-[var(--dt-muted)]'
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {statsQuery.isError && (
        <div
          role='alert'
          className='border border-[var(--dt-danger)] bg-[var(--dt-danger-soft)] p-4'
        >
          <p className='font-semibold text-[var(--dt-danger)]'>Recall rankings did not load.</p>
          <Button
            variant='outline'
            className='dt-control mt-3'
            onClick={() => void statsQuery.refetch()}
          >
            <RefreshCw className='size-4' />
            Try again
          </Button>
        </div>
      )}

      {statsQuery.isLoading ? (
        <div className='flex flex-col'>
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className='h-28 border-b dt-rule rounded-none' />
          ))}
        </div>
      ) : !statsQuery.isError && hot.length === 0 ? (
        <div className='dt-grid-lines flex min-h-72 flex-col items-start justify-center border-y dt-rule px-8 py-12'>
          <Flame className='size-7 text-[var(--dt-accent)]' />
          <h3 className='dt-display mt-5 text-xl font-semibold text-[var(--dt-ink)]'>
            No memories have been recalled yet
          </h3>
          <p className='dt-muted mt-2 max-w-[58ch] text-base'>
            Rankings appear after approved memories begin grounding Twin replies.
          </p>
        </div>
      ) : (
        !statsQuery.isError && (
          <ol className='border-t dt-rule'>
            {hot.map((memory, index) => (
              <li
                key={memory.hindsightMemoryId}
                className='grid grid-cols-[48px_minmax(0,1fr)] gap-4'
              >
                <span className='dt-display text-xl font-semibold tabular-nums text-[var(--dt-muted)]'>
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className='min-w-0'>
                  <MemoryCard
                    memory={
                      {
                        id: memory.hindsightMemoryId,
                        hindsightMemoryId: memory.hindsightMemoryId,
                        ...(memory.title ? { title: memory.title } : {}),
                        category: memory.category,
                        content: memory.content,
                        curatorReasoning: null,
                        curatorConfidence: null,
                        createdAt: memory.createdAt ?? '',
                        recallHits7d: memory.hits,
                        lastRecalledAt: memory.lastRecalledAt,
                        pipelineEventId: null,
                      } satisfies MemoryBankMemory
                    }
                    recallLabel={`${memory.hits.toLocaleString()} recall${memory.hits === 1 ? '' : 's'} in ${rangeLabel}`}
                    showTrace={false}
                    {...(memory.status === 'rejected'
                      ? {}
                      : {
                          onDelete: (hindsightMemoryId: string): void =>
                            setPendingDelete(hindsightMemoryId),
                        })}
                  />
                  {memory.status === 'rejected' && (
                    <p className='mb-4 text-sm font-semibold text-[var(--dt-danger)]'>
                      Deleted from the current ledger; retained here only as recall history.
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )
      )}

      <ConfirmDialog
        surface='digital-twin'
        open={pendingDelete !== null}
        onOpenChange={open => {
          if (!open) setPendingDelete(null);
        }}
        title='Delete this memory?'
        description='The memory leaves the ledger and related review rows become rejected. Recall history remains for audit purposes.'
        confirmLabel='Delete memory'
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteMutation.mutate(
            { hindsightMemoryId: pendingDelete },
            { onSuccess: () => setPendingDelete(null) },
          );
        }}
      />
    </div>
  );
};

export default DigitalTwinHotTab;
