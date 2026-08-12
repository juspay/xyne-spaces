import { ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenText, Filter, Search } from '@/components/ClawAgents/digitalTwin/icons';
import { useNavigate } from 'react-router-dom';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import {
  useDeleteDigitalTwinMemory,
  useInfiniteClawDigitalTwinMemories,
} from '@/hooks/useClawDigitalTwin';
import { MemoryCard } from '@/components/ClawAgents/digitalTwin/MemoryCard';
import { SUBSYSTEM_LABELS, subsystemLabel } from '@/components/ClawAgents/digitalTwin/subsystems';
import { cn } from '@/utils/classNames';

const PAGE_SIZE = 50;
const DELETE_COPY =
  'This removes the memory from your Twin and rejects related review rows. Recall history remains for audit purposes.';

const DigitalTwinMemoriesTab = (): ReactElement => {
  const navigate = useNavigate();
  const deleteMutation = useDeleteDigitalTwinMemory();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [subsystem, setSubsystem] = useState('all');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect((): (() => void) => {
    const timer = window.setTimeout((): void => {
      setDebouncedSearch(search.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useInfiniteClawDigitalTwinMemories({
    limit: PAGE_SIZE,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(subsystem !== 'all' ? { subsystem } : {}),
  });
  const memories = useMemo(
    () => query.data?.pages.flatMap(page => page.memories) ?? [],
    [query.data],
  );
  const total = query.data?.pages[0]?.total ?? 0;
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;

  useEffect((): (() => void) | undefined => {
    const target = loadMoreRef.current;
    if (!target || !hasNextPage) return undefined;

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '320px 0px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  return (
    <div className='flex flex-col gap-5'>
      <div className='flex h-9 w-full items-center gap-4 rounded-[10px] bg-foreground/[0.04] pl-2.5 pr-1'>
        <label
          htmlFor='digital-twin-memory-search'
          className='relative flex h-full min-w-0 flex-1 items-center'
        >
          <span className='sr-only'>Search memories</span>
          <Search className='pointer-events-none absolute left-0 top-1/2 z-10 size-4 -translate-y-1/2 text-foreground/40' />
          <Input
            id='digital-twin-memory-search'
            type='search'
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder='Search'
            className='h-full border-0 bg-transparent pl-6 pr-0 text-sm font-medium tracking-[-0.02em] shadow-none placeholder:text-foreground/40 focus-visible:border-0 focus-visible:ring-0'
            data-track-category='Claw Agents'
            data-track-name='Digital Twin search memories'
          />
        </label>

        <Select
          value={subsystem}
          onValueChange={value => {
            setSubsystem(value);
          }}
        >
          <SelectTrigger
            className={cn(
              'size-7 justify-center rounded-[10px] border-0 p-0 shadow-none hover:bg-foreground/[0.04]',
              '[&>svg:last-child]:hidden',
              subsystem === 'all' ? 'text-foreground/40' : 'bg-foreground/[0.08] text-foreground',
            )}
            aria-label={
              subsystem === 'all'
                ? 'Filter by knowledge area'
                : `Knowledge area filter: ${subsystemLabel(subsystem)}`
            }
            data-track-category='Claw Agents'
            data-track-name='Digital Twin memory subsystem filter'
          >
            <Filter className='size-4' />
            <span className='sr-only'>
              <SelectValue />
            </span>
          </SelectTrigger>
          <SelectContent align='end'>
            <SelectItem value='all'>All knowledge areas</SelectItem>
            {Object.keys(SUBSYSTEM_LABELS).map(key => (
              <SelectItem key={key} value={key}>
                {subsystemLabel(key)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className='max-w-[755px] pl-3 text-sm font-[450] leading-[1.3] text-foreground/40'>
        Approved knowledge your Twin may use. Open any source trail to see where a memory came from
        and why it was kept.
        <span className='sr-only' aria-live='polite'>
          {' '}
          {total.toLocaleString()} memor{total === 1 ? 'y' : 'ies'} available.
        </span>
      </p>

      {query.isError && memories.length === 0 && (
        <div role='alert' className='rounded-xl border border-destructive/30 bg-destructive/5 p-4'>
          <p className='text-sm font-semibold text-destructive'>Your memories did not load.</p>
          <p className='mt-1 text-sm text-muted-foreground'>{query.error.message}</p>
          <Button
            variant='outline'
            size='sm'
            className='mt-3'
            onClick={() => void query.refetch()}
            data-track-category='Claw Agents'
            data-track-name='Digital Twin retry memories'
          >
            Try again
          </Button>
        </div>
      )}

      {query.isLoading ? (
        <div className='flex flex-col'>
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className='border-b border-border py-5'>
              <Skeleton className='h-4 w-44' />
              <Skeleton className='mt-4 h-5 w-[86%]' />
              <Skeleton className='mt-2 h-5 w-[54%]' />
            </div>
          ))}
        </div>
      ) : memories.length === 0 ? (
        <div className='flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-8 py-12 text-center'>
          <BookOpenText className='size-7 text-muted-foreground' />
          <h3 className='mt-4 text-base font-semibold text-foreground'>
            {debouncedSearch || subsystem !== 'all'
              ? 'No memories match these filters'
              : 'Your Twin has no approved memories yet'}
          </h3>
          <p className='mt-1 max-w-[58ch] text-sm text-muted-foreground'>
            {debouncedSearch || subsystem !== 'all'
              ? 'Try a broader phrase or clear the knowledge-area filter.'
              : 'Review the Twin’s proposals to decide what belongs in its durable memory.'}
          </p>
          {(debouncedSearch || subsystem !== 'all') && (
            <Button
              variant='outline'
              size='sm'
              className='mt-4'
              onClick={() => {
                setSearch('');
                setDebouncedSearch('');
                setSubsystem('all');
              }}
              data-track-category='Claw Agents'
              data-track-name='Digital Twin clear memory filters'
            >
              Clear filters
            </Button>
          )}
          {!debouncedSearch && subsystem === 'all' && (
            <Button
              size='sm'
              className='mt-4'
              onClick={() => {
                void navigate('/claw-agents/digital-twin/proposals');
              }}
              data-track-category='Claw Agents'
              data-track-name='Digital Twin review from empty memories'
            >
              Review proposals
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className='dt-memory-list flex flex-col gap-4 pb-4'>
            {memories.map((memory, index) => (
              <MemoryCard
                key={memory.hindsightMemoryId}
                memory={memory}
                onDelete={setPendingDelete}
                expansionAnchor={index === 0 ? 'top' : 'bottom'}
              />
            ))}
          </div>

          <div ref={loadMoreRef} className='min-h-1' aria-hidden={!hasNextPage}>
            {isFetchingNextPage && (
              <div className='mt-2 flex flex-col gap-2' aria-label='Loading more memories'>
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className='h-16 rounded-xl' />
                ))}
              </div>
            )}

            {query.isFetchNextPageError && (
              <div role='alert' className='mt-4 rounded-xl border border-destructive/30 p-4'>
                <p className='text-sm font-semibold text-destructive'>
                  More memories could not be loaded.
                </p>
                <Button
                  variant='outline'
                  size='sm'
                  className='mt-3'
                  onClick={() => void fetchNextPage()}
                  data-track-category='Claw Agents'
                  data-track-name='Digital Twin retry more memories'
                >
                  Try again
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        surface='digital-twin'
        open={pendingDelete !== null}
        onOpenChange={open => {
          if (!open) setPendingDelete(null);
        }}
        title='Delete this memory?'
        description={DELETE_COPY}
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

export default DigitalTwinMemoriesTab;
