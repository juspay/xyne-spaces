import { ReactElement, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import { useClawDigitalTwinMemories, useDeleteDigitalTwinMemory } from '@/hooks/useClawDigitalTwin';
import { MemoryCard } from '@/components/ClawAgents/digitalTwin/MemoryCard';
import { CategoryBadge } from '@/components/ClawAgents/digitalTwin/CategoryBadge';
import { CATEGORY_LEGEND, CATEGORY_STYLES } from '@/components/ClawAgents/digitalTwin/subsystems';

const DELETE_COPY =
  'This removes it from Hindsight and marks all related review rows as rejected. Recall-hit history is retained.';

const DigitalTwinMemoriesTab = (): ReactElement => {
  const { data, isLoading } = useClawDigitalTwinMemories();
  const deleteMutation = useDeleteDigitalTwinMemory();
  const [search, setSearch] = useState('');
  const [legendOpen, setLegendOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const memories = useMemo(() => data?.memories ?? [], [data]);
  const total = data?.total ?? memories.length;

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return memories;
    return memories.filter(m => m.content.toLowerCase().includes(q));
  }, [memories, search]);

  const visibleCategories = useMemo(
    () =>
      new Set(
        memories.map(m => (m.category ?? '').toLowerCase()).filter(c => c in CATEGORY_STYLES),
      ),
    [memories],
  );

  if (isLoading) {
    return (
      <div className='flex flex-col gap-1.5'>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className='h-16 rounded-lg' />
        ))}
      </div>
    );
  }

  if (memories.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-12 text-center'>
        <p className='text-[13px] text-muted-foreground'>No memories yet</p>
        <p className='text-xs text-muted-foreground'>
          Go to Proposals, approve the ones that look right, and they&apos;ll show up here
        </p>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-2.5'>
      <div className='flex flex-wrap items-center gap-3'>
        <div className='relative w-full sm:w-80'>
          <Search className='pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
          <input
            type='text'
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-track-category='Claw Agents'
            data-track-name='Digital Twin search memories'
            placeholder='Search memories…'
            className='h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
          />
        </div>
        <span className='text-[11px] text-muted-foreground'>
          {search.trim()
            ? `${filtered.length} of ${memories.length} loaded · ${total} total`
            : `${memories.length} of ${total} memories`}
        </span>
      </div>

      {visibleCategories.size > 0 && (
        <div className='rounded-lg border border-border bg-muted/40'>
          <button
            type='button'
            onClick={() => setLegendOpen(o => !o)}
            data-track-category='Claw Agents'
            data-track-name='Digital Twin category legend toggle'
            className='flex w-full items-center justify-between px-2.5 py-1.5 text-left'
          >
            <span className='text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
              Category guide
            </span>
            {legendOpen ? (
              <ChevronUp className='size-3 text-muted-foreground' />
            ) : (
              <ChevronDown className='size-3 text-muted-foreground' />
            )}
          </button>
          {legendOpen && (
            <div className='flex flex-col gap-1.5 border-t border-border px-2.5 py-2'>
              {CATEGORY_LEGEND.filter(row => visibleCategories.has(row.key)).map(row => (
                <div key={row.key} className='flex items-start gap-2'>
                  <CategoryBadge category={row.key} />
                  <span className='text-[11px] text-muted-foreground'>{row.description}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {filtered.length === 0 && search.trim() && (
        <p className='py-4 text-center text-xs text-muted-foreground'>
          No memories match &ldquo;{search}&rdquo;
        </p>
      )}

      <div className='flex flex-col gap-1.5'>
        {filtered.map(memory => (
          <MemoryCard key={memory.hindsightMemoryId} memory={memory} onDelete={setPendingDelete} />
        ))}
      </div>

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

export default DigitalTwinMemoriesTab;
