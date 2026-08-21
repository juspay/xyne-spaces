import { ReactElement, useMemo, useState } from 'react';
import { DeleteDustbin01 } from '@xyne/icons';
import { AdminSearchField } from '@/routes/AIScreen/library/admin/components/AdminSearchField';
import { Button } from '@/components/ui/Button/index';
import Tooltip from '@/components/ui/Tooltip';
import { TruncatedTooltip } from '@/components/ui/Tooltip/TruncatedTooltip';
import { Skeleton } from '@/components/ui/Skeleton';
import { SegmentedToggle } from '@/components/ui/SegmentedToggle';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import { useClawDigitalTwinStats, useDeleteDigitalTwinMemory } from '@/hooks/useClawDigitalTwin';
import { CategoryBadge } from '../components/CategoryBadgeV2';
import { MetaRow } from '../components/MetaRow';
import { fmtRelative } from '../components/formatV2';
import type { MemoryRange } from '@/services/claw/digitalTwinTypes';

const RANGES: MemoryRange[] = ['7d', '30d', '90d'];
const DELETE_COPY =
  'This removes it from Hindsight and marks related review rows as rejected. Recall-hit history is retained.';

const DigitalTwinHotTab = (): ReactElement => {
  const [range, setRange] = useState<MemoryRange>('7d');
  const { data: stats, isLoading } = useClawDigitalTwinStats(range);
  const deleteMutation = useDeleteDigitalTwinMemory();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const allHot = useMemo(() => stats?.hot ?? [], [stats]);
  const hot = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return allHot;
    return allHot.filter(m => m.content.toLowerCase().includes(q));
  }, [allHot, search]);

  return (
    <div className='flex flex-col gap-2.5'>
      <AdminSearchField
        value={search}
        onChange={setSearch}
        placeholder='Search hot memories'
        ariaLabel='Search hot memories'
        trackCategory='Claw Agents'
        trackName='Digital Twin: search hot memories'
        className='w-full'
      />

      <div className='flex items-center justify-end'>
        <SegmentedToggle<MemoryRange>
          options={RANGES.map(r => ({ value: r, label: r }))}
          value={range}
          onChange={setRange}
          tone='primary'
          trackCategory='Claw Agents'
          trackPrefix='Digital Twin hot range'
        />
      </div>

      {isLoading ? (
        <div className='flex flex-col gap-1.5'>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className='h-12 rounded-lg' />
          ))}
        </div>
      ) : hot.length === 0 && search.trim() ? (
        <p className='py-4 text-xs text-muted-foreground'>
          No hot memories match &ldquo;{search}&rdquo;
        </p>
      ) : hot.length === 0 ? (
        <div className='flex flex-col gap-1 py-4'>
          <p className='text-xs text-muted-foreground'>No hot memories</p>
          <p className='text-xs text-muted-foreground'>
            Memories will appear here once they start getting recalled
          </p>
        </div>
      ) : (
        <ul className='flex flex-col'>
          {hot.map(m => {
            const isRejected = m.status === 'rejected';
            return (
              <li
                key={m.hindsightMemoryId}
                className='flex flex-col gap-1 border-b border-border px-1 py-4'
              >
                <div className='flex items-center justify-between gap-3'>
                  <TruncatedTooltip content={m.content}>
                    <p className='min-w-0 flex-1 truncate text-sm text-foreground'>{m.content}</p>
                  </TruncatedTooltip>
                  {!isRejected && (
                    <Tooltip content='Delete memory' side='top'>
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        onClick={() => setPendingDelete(m.hindsightMemoryId)}
                        aria-label='Delete memory'
                        data-track-category='Claw Agents'
                        data-track-name='Digital Twin delete hot memory'
                        className='shrink-0 text-muted-foreground hover:text-destructive focus-visible:bg-muted focus-visible:ring-0'
                      >
                        <DeleteDustbin01 className='size-4' aria-hidden />
                      </Button>
                    </Tooltip>
                  )}
                </div>
                <MetaRow
                  badge={<CategoryBadge category={m.category} />}
                  items={[
                    <span key='recalls'>
                      {m.hits} recall{m.hits !== 1 ? 's' : ''}
                    </span>,
                    m.lastRecalledAt && (
                      <span key='recalled'>last recalled {fmtRelative(m.lastRecalledAt)}</span>
                    ),
                    isRejected && (
                      <span key='deleted' className='text-destructive'>
                        deleted from Hindsight
                      </span>
                    ),
                  ]}
                />
              </li>
            );
          })}
        </ul>
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
