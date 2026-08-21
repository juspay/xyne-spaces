import { createElement, ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import {
  BookOpenText,
  ChatChatting,
  CheckTickSquare,
  File02Default,
  Filter,
  FolderDefault,
  GitBranch,
  GitCompare,
  GitFork01,
  GraduationHat,
  SlidersHorizontal,
  Square,
  type DigitalTwinIcon,
} from '@/components/ClawAgents/digitalTwin/icons';
import { useNavigate } from 'react-router-dom';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import {
  useDeleteDigitalTwinMemory,
  useInfiniteClawDigitalTwinMemories,
} from '@/hooks/useClawDigitalTwin';
import { MemoryCard } from '@/components/ClawAgents/digitalTwin/MemoryCard';
import { subsystemLabel } from '@/components/ClawAgents/digitalTwin/subsystems';
import { DetailGroup } from '@/routes/AIScreen/library/shared/primitives/DetailPrimitives';
import { cn } from '@/utils/classNames';

const PAGE_SIZE = 50;
const KNOWLEDGE_AREA_FILTERS: ReadonlyArray<{
  value: string;
  label: string;
  icon: DigitalTwinIcon;
}> = [
  { value: 'style', label: 'Communication', icon: ChatChatting },
  { value: 'expertise', label: 'Expertise', icon: GraduationHat },
  { value: 'projects', label: 'Projects', icon: FolderDefault },
  { value: 'relationships', label: 'Relationships', icon: GitCompare },
  { value: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
  { value: 'decisions', label: 'Decisions', icon: GitBranch },
  { value: 'docs', label: 'Documents', icon: File02Default },
  { value: 'context', label: 'Context', icon: GitFork01 },
];
const DELETE_COPY =
  'This removes the memory from your Twin and rejects related review rows. Recall history remains for audit purposes.';

const knowledgeAreaFilterLabel = (value: string): string =>
  KNOWLEDGE_AREA_FILTERS.find(filter => filter.value === value)?.label ?? subsystemLabel(value);

const DigitalTwinMemoriesTab = (): ReactElement => {
  const navigate = useNavigate();
  const deleteMutation = useDeleteDigitalTwinMemory();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedSubsystems, setSelectedSubsystems] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const filtersActive = debouncedSearch.length > 0 || selectedSubsystems.length > 0;
  const filterAriaLabel =
    selectedSubsystems.length === 0
      ? 'Filter by knowledge area'
      : selectedSubsystems.length === 1
        ? `Knowledge area filter: ${knowledgeAreaFilterLabel(selectedSubsystems[0]!)}`
        : `Knowledge area filter: ${selectedSubsystems.length} selected`;

  useEffect((): (() => void) => {
    const timer = window.setTimeout((): void => {
      setDebouncedSearch(search.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useInfiniteClawDigitalTwinMemories({
    limit: PAGE_SIZE,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(selectedSubsystems.length > 0 ? { subsystems: selectedSubsystems } : {}),
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
    <div className='flex flex-col gap-6'>
      <DetailGroup typeScale='twin' className='gap-0'>
        <div className='flex items-center gap-2'>
          <label
            htmlFor='digital-twin-memory-search'
            className='relative flex min-w-0 flex-1 items-center gap-2'
          >
            <span className='sr-only'>Search memories</span>
            <Search className='pointer-events-none size-4 shrink-0 text-muted-foreground' />
            <Input
              id='digital-twin-memory-search'
              type='search'
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder='Search memories'
              className='h-9 border-0 bg-transparent px-0 shadow-none placeholder:text-muted-foreground focus-visible:border-0 focus-visible:ring-0'
              data-testid='digital-twin-memory-search'
              data-track-category='Claw Agents'
              data-track-name='Digital Twin search memories'
            />
          </label>

          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                'relative flex size-7 shrink-0 items-center justify-center rounded-[10px] border-0 p-0 text-foreground/40 shadow-none outline-none hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=open]:bg-foreground/[0.06]',
                selectedSubsystems.length > 0 && 'bg-foreground/[0.06]',
              )}
              aria-label={filterAriaLabel}
              data-track-category='Claw Agents'
              data-track-name='Digital Twin memory subsystem filter'
            >
              <Filter className='size-4' />
              {selectedSubsystems.length > 0 && (
                <span
                  aria-hidden='true'
                  className='absolute top-1 right-1 size-[6px] rounded-full bg-sidebar-primary'
                />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='dt-filter-menu-content'>
              {KNOWLEDGE_AREA_FILTERS.map(({ value, label, icon }) => {
                const selected = selectedSubsystems.includes(value);
                return (
                  <DropdownMenuItem
                    key={value}
                    className='dt-filter-menu-item'
                    data-selected={selected}
                    onSelect={event => {
                      event.preventDefault();
                      setSelectedSubsystems(previous =>
                        selected ? previous.filter(item => item !== value) : [...previous, value],
                      );
                    }}
                  >
                    <span className='dt-filter-menu-item-label'>
                      {createElement(icon, { ['aria-hidden']: true })}
                      <span>{label}</span>
                    </span>
                    <span className='dt-filter-menu-check' aria-hidden='true'>
                      {selected ? (
                        <CheckTickSquare variant='Solid' className='size-4 text-primary' />
                      ) : (
                        <Square className='size-4 text-foreground/25' />
                      )}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </DetailGroup>

      <span className='sr-only' aria-live='polite'>
        {total.toLocaleString()} memor{total === 1 ? 'y' : 'ies'} available.
      </span>

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
            {filtersActive
              ? 'No memories match these filters'
              : 'Your Twin has no approved memories yet'}
          </h3>
          <p className='mt-1 max-w-[58ch] text-sm text-muted-foreground'>
            {filtersActive
              ? 'Try a broader phrase or clear the knowledge-area filter.'
              : 'Review the Twin’s proposals to decide what belongs in its durable memory.'}
          </p>
          {filtersActive && (
            <Button
              variant='outline'
              size='sm'
              className='mt-4'
              onClick={() => {
                setSearch('');
                setDebouncedSearch('');
                setSelectedSubsystems([]);
              }}
              data-track-category='Claw Agents'
              data-track-name='Digital Twin clear memory filters'
            >
              Clear filters
            </Button>
          )}
          {!debouncedSearch && selectedSubsystems.length === 0 && (
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
