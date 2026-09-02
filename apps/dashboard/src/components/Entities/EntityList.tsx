import { JSX, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select/Select';
import { cn } from '../../utils/classNames';
import { entitiesApi, type EntityListItem } from '../../api/entitiesApi';

interface EntityListProps {
  selectedId: string | null;
  onSelect: (entity: EntityListItem) => void;
}

const PAGE_SIZE = 50;
const ALL_TYPES = '__all__';

/**
 * Pick a type, then an entity.
 *
 * Type is a dropdown rather than a row of chips: the list is workspace-defined and
 * open-ended, so chips would wrap unpredictably and compete with the entity names
 * for attention. Type is a filter you set once and forget; the entity is the thing
 * you actually scan.
 */
export const EntityList = ({ selectedId, onSelect }: EntityListProps): JSX.Element => {
  const [type, setType] = useState<string>(ALL_TYPES);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { data: types = [] } = useQuery({
    queryKey: ['entity-types'],
    queryFn: () => entitiesApi.listTypes(),
    staleTime: 5 * 60 * 1000,
  });

  const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      // Type is part of the key, so changing it starts a fresh list from offset 0
      // rather than appending to the old one.
      queryKey: ['entities', type],
      queryFn: ({ pageParam }) =>
        entitiesApi.listEntities({
          ...(type !== ALL_TYPES ? { type } : {}),
          limit: PAGE_SIZE,
          offset: pageParam,
        }),
      initialPageParam: 0,
      getNextPageParam: (lastPage, allPages) => {
        const loaded = allPages.reduce((n, p) => n + p.entities.length, 0);
        return loaded < lastPage.total ? loaded : undefined;
      },
    });

  const entities = useMemo(() => (data?.pages ?? []).flatMap(p => p.entities), [data]);
  const total = data?.pages?.[0]?.total ?? 0;

  // Paging state via a ref so the observer is created once; re-observing an
  // already-visible sentinel after every page would fetch the whole list at once.
  const pagingRef = useRef({ hasNextPage, isFetchingNextPage, fetchNextPage });
  pagingRef.current = { hasNextPage, isFetchingNextPage, fetchNextPage };

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;

    const observer = new IntersectionObserver(
      entries => {
        if (!entries[0]?.isIntersecting) return;
        const {
          hasNextPage: more,
          isFetchingNextPage: busy,
          fetchNextPage: next,
        } = pagingRef.current;
        if (more && !busy) void next();
      },
      { root, threshold: 0.1 },
    );

    observer.observe(sentinel);
    return (): void => observer.disconnect();
  }, []);

  const resetScroll = (): void => scrollRef.current?.scrollTo({ top: 0 });

  return (
    <div className='flex flex-col h-full min-h-0 overflow-hidden border-r border-border'>
      <div className='p-3 border-b border-border shrink-0'>
        <Select
          value={type}
          onValueChange={value => {
            setType(value);
            resetScroll();
          }}
        >
          <SelectTrigger size='sm' className='w-full'>
            <SelectValue placeholder='All types' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TYPES}>All types</SelectItem>
            {types.map(t => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div ref={scrollRef} className='flex-1 min-h-0 overflow-y-auto'>
        {isLoading && entities.length === 0 && (
          <p className='text-xs text-muted-foreground p-4'>Loading entities…</p>
        )}

        {/* Distinct from the empty state on purpose: a failed request previously
            rendered as "nothing extracted", which points the reader at the data
            when the problem is the request. */}
        {isError && (
          <div className='p-4 text-xs'>
            <p className='text-destructive'>Could not load entities.</p>
            <p className='text-muted-foreground mt-1 break-words'>
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
          </div>
        )}

        {!isLoading && !isError && entities.length === 0 && (
          <p className='text-xs text-muted-foreground p-4'>
            {type !== ALL_TYPES
              ? 'No entities of this type.'
              : 'No entities have been extracted yet.'}
          </p>
        )}

        {entities.map(entity => (
          <button
            key={entity.id}
            type='button'
            onClick={() => onSelect(entity)}
            className={cn(
              'w-full flex items-baseline gap-2 px-3 py-2 text-left border-b border-border/40',
              'hover:bg-accent/60 transition-colors',
              selectedId === entity.id && 'bg-accent',
            )}
            data-track-category='Entities'
            data-track-name='SelectEntity'
          >
            <span className='flex-1 min-w-0 truncate text-sm'>{entity.canonicalName}</span>
            {/* Type is only worth repeating per row when the list is unfiltered. */}
            {type === ALL_TYPES && (
              <span className='shrink-0 text-[11px] text-muted-foreground'>{entity.type}</span>
            )}
            <span className='shrink-0 text-[11px] text-muted-foreground tabular-nums'>
              {entity.mentionCount}
            </span>
          </button>
        ))}

        {/* Always mounted — the observer is created once on mount. */}
        <div ref={sentinelRef} className='h-1' aria-hidden='true' />

        {isFetchingNextPage && (
          <div className='flex items-center justify-center gap-2 p-3 text-xs text-muted-foreground'>
            <Loader2 className='size-3.5 animate-spin' />
            Loading more…
          </div>
        )}
      </div>

      {entities.length > 0 && (
        <div className='px-3 py-1.5 border-t border-border text-[11px] text-muted-foreground shrink-0'>
          {entities.length} of {total}
        </div>
      )}
    </div>
  );
};

export default EntityList;
