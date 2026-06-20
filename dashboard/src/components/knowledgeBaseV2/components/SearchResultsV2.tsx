import React from 'react';
import { File } from 'lucide-react';
import { CollectionChild } from '../../../services/Knowledge/collectionService';
import { StatusBadgeV2 } from './StatusBadgeV2';
import { IngestStatusV2 } from './IngestStatusV2';

interface SearchResultsV2Props {
  query: string;
  loading: boolean;
  error: string | null;
  hits: CollectionChild[];
  onOpen: (hit: CollectionChild) => void;
}

export const SearchResultsV2: React.FC<SearchResultsV2Props> = ({
  query,
  loading,
  error,
  hits,
  onOpen,
}) => {
  return (
    <div className='flex flex-col gap-3'>
      <p className='text-[12px] text-muted-foreground'>
        {loading
          ? 'Searching...'
          : error
            ? 'Search failed'
            : hits.length === 0
              ? `No files match "${query}"`
              : `${String(hits.length)} match${hits.length === 1 ? '' : 'es'} for "${query}"`}
      </p>

      {error ? (
        <div className='rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[12.5px] text-destructive'>
          {error}
        </div>
      ) : null}

      {loading && hits.length === 0 ? (
        <ul aria-busy='true' aria-label='Loading results' className='flex flex-col gap-1'>
          {Array.from({ length: 6 }).map((_, i) => (
            <li
              key={i}
              aria-hidden
              className='flex items-center gap-3 rounded-lg border border-border bg-secondary px-3.5 py-2.5'
            >
              <div className='h-7 w-7 flex-shrink-0 animate-pulse rounded-md bg-muted' />
              <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
                <div className='h-2.5 w-1/2 animate-pulse rounded-full bg-muted' />
                <div className='h-2 w-1/3 animate-pulse rounded-full bg-muted' />
              </div>
            </li>
          ))}
        </ul>
      ) : hits.length === 0 && !error ? (
        <div className='mx-auto flex max-w-md flex-col items-center justify-center gap-3 py-16 text-center'>
          <span className='grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-muted-foreground'>
            <File className='h-5 w-5' aria-hidden strokeWidth={1.5} />
          </span>
          <p className='text-[14px] font-medium text-foreground'>No matches</p>
          <p className='max-w-xs text-[12.5px] text-muted-foreground'>
            Nothing matched{' '}
            <span className='font-medium text-foreground'>&ldquo;{query}&rdquo;</span>. Try a
            shorter or different term.
          </p>
        </div>
      ) : (
        <ul aria-label='Search results' className='flex flex-col gap-1'>
          {hits.map(hit => (
            <li key={hit.id}>
              <button
                type='button'
                onClick={() => onOpen(hit)}
                className='group flex w-full items-center gap-3 rounded-lg border border-border bg-secondary px-3.5 py-2.5 text-left transition hover:border-ring/40 hover:bg-muted'
                data-track-category='knowledge-base'
                data-track-name='open-search-result'
              >
                <StatusBadgeV2 name={hit.name} />
                <div className='flex min-w-0 flex-1 flex-col'>
                  <span className='flex min-w-0 items-center gap-1.5'>
                    <span className='truncate text-[13.5px] leading-tight text-foreground'>
                      {highlightMatch(hit.name, query)}
                    </span>
                    <IngestStatusV2 status={hit.ingestionStatus} />
                  </span>
                  {hit.parentId ? (
                    <span className='truncate text-[11.5px] leading-tight text-muted-foreground'>
                      Inside folder
                    </span>
                  ) : null}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

function highlightMatch(name: string, q: string): React.ReactNode {
  if (q === '') return name;
  const lower = name.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx < 0) return name;
  const before = name.slice(0, idx);
  const match = name.slice(idx, idx + q.length);
  const after = name.slice(idx + q.length);
  return (
    <>
      {before}
      <span className='rounded-sm bg-foreground/10 px-[1px] font-medium text-foreground'>
        {match}
      </span>
      {after}
    </>
  );
}
