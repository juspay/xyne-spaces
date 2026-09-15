import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import {
  useClawDigitalTwinMemory,
  useClawDigitalTwinPipelineEvent,
  useClawDigitalTwinStatus,
  useInfiniteClawDigitalTwinMemories,
} from '@/hooks/useClawDigitalTwin';
import { buildMemoryFolderCopy } from './memoryFolderCopy';
import { MemoryFolderStack } from './MemoryFolderStack';
import './memory-folders.css';

const PAGE_SIZE = 50;
const PREFETCH_RADIUS = 8;

export function MemoryFolderBrowser(): ReactElement {
  const { workspaceId, memoryId } = useParams<{ workspaceId?: string; memoryId?: string }>();
  const [focusedIndex, setFocusedIndex] = useState(0);
  const prefixWs = (path: string): string => (workspaceId ? `/${workspaceId}${path}` : path);

  const twinStatus = useClawDigitalTwinStatus();
  const query = useInfiniteClawDigitalTwinMemories({ limit: PAGE_SIZE });
  const listedMemories = useMemo(
    () => query.data?.pages.flatMap(page => page.memories) ?? [],
    [query.data],
  );
  const missingSelected =
    !!memoryId && !listedMemories.some(memory => memory.hindsightMemoryId === memoryId);
  const selectedQuery = useClawDigitalTwinMemory(missingSelected ? memoryId : undefined);

  const memories = useMemo(() => {
    const selected = selectedQuery.data;
    if (!selected) return listedMemories;
    if (listedMemories.some(memory => memory.hindsightMemoryId === selected.hindsightMemoryId)) {
      return listedMemories;
    }
    return [selected, ...listedMemories];
  }, [listedMemories, selectedQuery.data]);

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  const requestMore = useCallback((): void => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  useEffect(() => {
    if (!twinStatus.data?.enabled) return;
    if (!hasNextPage || isFetchingNextPage) return;
    if (missingSelected || focusedIndex >= memories.length - PREFETCH_RADIUS) requestMore();
  }, [
    focusedIndex,
    hasNextPage,
    isFetchingNextPage,
    memories.length,
    missingSelected,
    requestMore,
    twinStatus.data?.enabled,
  ]);

  useEffect(() => {
    if (memories.length === 0) {
      setFocusedIndex(0);
      return;
    }
    if (memoryId) {
      const index = memories.findIndex(memory => memory.hindsightMemoryId === memoryId);
      if (index >= 0) {
        setFocusedIndex(index);
        return;
      }
    }
    setFocusedIndex(previous => Math.min(previous, memories.length - 1));
  }, [memories, memoryId]);

  const focusedMemory = memories[focusedIndex];
  const pipelineQuery = useClawDigitalTwinPipelineEvent(focusedMemory?.pipelineEventId ?? null);

  const copies = useMemo(
    () =>
      memories.map(memory =>
        buildMemoryFolderCopy(
          memory,
          memory.hindsightMemoryId === focusedMemory?.hindsightMemoryId
            ? pipelineQuery.data
            : undefined,
        ),
      ),
    [focusedMemory?.hindsightMemoryId, memories, pipelineQuery.data],
  );

  const twinOff = Boolean(twinStatus.data && !twinStatus.data.enabled);
  const showStatusError = twinStatus.isError && !twinStatus.data;
  const showLoading = !twinOff && (twinStatus.isLoading || query.isLoading);
  const showMemoriesError = Boolean(
    twinStatus.data?.enabled && query.isError && memories.length === 0,
  );
  const showEmpty = Boolean(
    twinStatus.data?.enabled && !query.isLoading && memories.length === 0 && !query.isError,
  );
  const showMemories = Boolean(twinStatus.data?.enabled && copies.length > 0);

  return (
    <MotionConfig reducedMotion='user'>
      <div className='flex h-full min-h-0 flex-1 flex-col overflow-hidden'>
        {showMemories ? (
          <MemoryFolderStack
            copies={copies}
            focusedIndex={focusedIndex}
            onFocusedIndexChange={setFocusedIndex}
            onNeedMore={requestMore}
          />
        ) : (
          <div className='memory-folders' data-testid='memory-folders'>
            <header className='memory-folders__header'>
              <svg viewBox='0 0 16 16' fill='none' aria-hidden='true'>
                <path
                  d='M2.5 4.5 8 1.75 13.5 4.5V7.25L8 10 2.5 7.25V4.5Z'
                  stroke='currentColor'
                  strokeWidth='1.2'
                  strokeLinejoin='round'
                />
                <path
                  d='M2.5 8.25 8 11 13.5 8.25'
                  stroke='currentColor'
                  strokeWidth='1.2'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                />
                <path
                  d='M2.5 11.25 8 14 13.5 11.25'
                  stroke='currentColor'
                  strokeWidth='1.2'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                />
              </svg>
              <h1>Memories</h1>
            </header>

            {twinOff && (
              <div className='memory-folders__status'>
                <h2>Learning is off</h2>
                <p>
                  Turn on your Digital Twin in settings to browse distilled memories from your
                  workspace history.
                </p>
                <Button size='sm' className='mt-3' asChild>
                  <Link to={prefixWs('/ai/settings/overview')}>Open settings</Link>
                </Button>
              </div>
            )}

            {showStatusError && (
              <div className='memory-folders__status' role='alert'>
                <h2>Memory could not load</h2>
                <p>{twinStatus.error?.message ?? 'Please try again.'}</p>
                <Button
                  variant='outline'
                  size='sm'
                  className='mt-3'
                  onClick={() => void twinStatus.refetch()}
                >
                  Try again
                </Button>
              </div>
            )}

            {showMemoriesError && (
              <div className='memory-folders__status' role='alert'>
                <h2>Memories did not load</h2>
                <p>{query.error?.message ?? 'Please try again.'}</p>
                <Button
                  variant='outline'
                  size='sm'
                  className='mt-3'
                  onClick={() => void query.refetch()}
                >
                  Try again
                </Button>
              </div>
            )}

            {showLoading && (
              <div className='memory-folders__status' aria-label='Loading memories'>
                <h2>Loading memories</h2>
                <p>Assembling the folder stack from your Twin’s durable knowledge.</p>
              </div>
            )}

            {showEmpty && (
              <div className='memory-folders__status'>
                <h2>No memories yet</h2>
                <p>Review proposals to decide what belongs in your Twin’s durable memory.</p>
                <Button size='sm' className='mt-3' asChild>
                  <Link to={prefixWs('/ai/settings/review')}>Review proposals</Link>
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </MotionConfig>
  );
}

export default MemoryFolderBrowser;
