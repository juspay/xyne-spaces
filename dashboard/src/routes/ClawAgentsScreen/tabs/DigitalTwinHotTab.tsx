import { ReactElement, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import { cn } from '@/utils/classNames';
import { useClawDigitalTwinStats, useDeleteDigitalTwinMemory } from '@/hooks/useClawDigitalTwin';
import { CategoryBadge } from '@/components/ClawAgents/digitalTwin/CategoryBadge';
import { fmtRelative } from '@/components/ClawAgents/digitalTwin/format';
import type { MemoryRange } from '@/services/claw/digitalTwinTypes';

const RANGES: MemoryRange[] = ['7d', '30d', '90d'];
const DELETE_COPY =
  'This removes it from Hindsight and marks related review rows as rejected. Recall-hit history is retained.';

const DigitalTwinHotTab = (): ReactElement => {
  const [range, setRange] = useState<MemoryRange>('7d');
  const { data: stats, isLoading } = useClawDigitalTwinStats(range);
  const deleteMutation = useDeleteDigitalTwinMemory();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const hot = stats?.hot ?? [];

  return (
    <div className='flex flex-col gap-2.5'>
      <div className='flex items-center justify-between'>
        <span className='text-xs text-muted-foreground'>Memories ranked by recall frequency</span>
        <div className='flex items-center rounded-lg border border-border bg-muted/40 p-0.5'>
          {RANGES.map(r => (
            <button
              key={r}
              type='button'
              onClick={() => setRange(r)}
              data-track-category='Claw Agents'
              data-track-name='Digital Twin hot range'
              className={cn(
                'rounded-md px-2.5 py-1 text-[11px] font-medium transition',
                range === r
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className='flex flex-col gap-1.5'>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className='h-12 rounded-lg' />
          ))}
        </div>
      ) : hot.length === 0 ? (
        <div className='flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-12 text-center'>
          <p className='text-[13px] text-muted-foreground'>No hot memories</p>
          <p className='text-xs text-muted-foreground'>
            Memories will appear here once they start getting recalled
          </p>
        </div>
      ) : (
        <ol className='flex flex-col gap-1.5'>
          {hot.map((m, idx) => {
            const isRejected = m.status === 'rejected';
            return (
              <li
                key={m.hindsightMemoryId}
                className='flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-2.5'
              >
                <span className='mt-px inline-flex h-5 min-w-[26px] shrink-0 items-center justify-center rounded-full bg-background px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground'>
                  #{idx + 1}
                </span>
                <div className='min-w-0 flex-1'>
                  <p className='text-xs text-foreground'>{m.content}</p>
                  <div className='mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground'>
                    <CategoryBadge category={m.category} />
                    <span>
                      {m.hits} recall{m.hits !== 1 ? 's' : ''}
                    </span>
                    {m.lastRecalledAt && <span>last recalled {fmtRelative(m.lastRecalledAt)}</span>}
                    {isRejected && (
                      <span className='text-destructive'>(deleted from Hindsight)</span>
                    )}
                  </div>
                </div>
                {!isRejected && (
                  <button
                    type='button'
                    onClick={() => setPendingDelete(m.hindsightMemoryId)}
                    data-track-category='Claw Agents'
                    data-track-name='Digital Twin delete hot memory'
                    className='shrink-0 text-muted-foreground transition-colors hover:text-destructive'
                    title='Delete memory'
                    aria-label='Delete memory'
                  >
                    <Trash2 className='size-3.5' />
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={open => {
          if (!open) setPendingDelete(null);
        }}
        title='Delete this memory?'
        description={DELETE_COPY}
        confirmLabel='Delete'
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
