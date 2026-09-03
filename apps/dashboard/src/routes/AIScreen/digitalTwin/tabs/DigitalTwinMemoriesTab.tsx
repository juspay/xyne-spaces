import { ReactElement, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { AdminSearchField } from '@/routes/AIScreen/library/admin/components/AdminSearchField';
import { TabMessage } from '@/routes/AIScreen/library/admin/components/TabMessage';
import { Skeleton } from '@/components/ui/Skeleton';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import { useClawDigitalTwinMemories, useDeleteDigitalTwinMemory } from '@/hooks/useClawDigitalTwin';
import { MemoryCard } from '../components/MemoryCard';
import { CategoryBadge } from '../components/CategoryBadge';
import { CATEGORY_LEGEND, CATEGORY_STYLES } from '../components/subsystems';

const DELETE_COPY =
  'This removes it from Hindsight and marks all related review rows as rejected. Recall-hit history is retained.';

const DigitalTwinMemoriesTab = (): ReactElement => {
  const { data, isLoading } = useClawDigitalTwinMemories();
  const deleteMutation = useDeleteDigitalTwinMemory();
  const [search, setSearch] = useState('');
  const [legendOpen, setLegendOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const memories = useMemo(() => data?.memories ?? [], [data]);

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

  return (
    <div className='flex flex-col gap-2.5'>
      <div className='sticky top-0 z-10 -mb-2.5 bg-background pb-2.5'>
        <AdminSearchField
          value={search}
          onChange={setSearch}
          placeholder='Search memories'
          ariaLabel='Search memories'
          trackCategory='Claw Agents'
          trackName='Digital Twin: search memories'
          className='w-full'
        />
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
            <span className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
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
                  <span className='text-xs text-muted-foreground'>{row.description}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <div className='flex flex-col gap-1.5'>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className='h-16 rounded-lg' />
          ))}
        </div>
      ) : filtered.length === 0 && search.trim() ? (
        <TabMessage>No memories match &ldquo;{search}&rdquo;</TabMessage>
      ) : memories.length === 0 ? (
        <TabMessage>
          No memories yet — go to Proposals, approve the ones that look right, and they’ll show up
          here.
        </TabMessage>
      ) : (
        <ul className='flex flex-col'>
          {filtered.map(memory => (
            <MemoryCard
              key={memory.hindsightMemoryId}
              memory={memory}
              onDelete={setPendingDelete}
              query={search}
            />
          ))}
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

export default DigitalTwinMemoriesTab;
