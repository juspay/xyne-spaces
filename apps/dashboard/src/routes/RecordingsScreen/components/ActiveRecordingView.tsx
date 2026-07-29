/**
 * ActiveRecordingView - Live transcript panel for active recordings..
 */

import type { ReactElement, RefObject } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Skeleton } from '../../../components/ui/Skeleton';
import { useTextSearch } from '../../../hooks/useTextSearch';
import type { TranscriptEntry } from '../../../stores/recordingStore';
import { formatElapsedTime } from '../../../utils/recordingUtils';
import { HighlightedText } from './HighlightedText';

// Layout constants
const SKELETON_ROW_HEIGHT = 48;
const SKELETON_ROW_GAP = 24;
const LISTENING_INDICATOR_HEIGHT = 40;

const SKELETON_WIDTH_PATTERNS = [
  { w1: '95%', w2: '60%' },
  { w1: '80%', w2: null },
  { w1: '88%', w2: '45%' },
  { w1: '75%', w2: '55%' },
  { w1: '92%', w2: null },
  { w1: '85%', w2: '40%' },
  { w1: '78%', w2: null },
  { w1: '90%', w2: '50%' },
  { w1: '82%', w2: '35%' },
  { w1: '88%', w2: null },
  { w1: '76%', w2: '45%' },
  { w1: '84%', w2: null },
];

// ─────────────────────────────────────────────────────────────────────────────
// TranscriptSearchBar - Local search UI component
// ─────────────────────────────────────────────────────────────────────────────

interface TranscriptSearchBarProps {
  isOpen: boolean;
  query: string;
  matchCount: number;
  currentIndex: number;
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
  onOpen: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

function TranscriptSearchBar({
  isOpen,
  query,
  matchCount,
  currentIndex,
  onQueryChange,
  onNext,
  onPrevious,
  onClose,
  onOpen,
  onKeyDown,
}: TranscriptSearchBarProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  return (
    <AnimatePresence mode='wait'>
      {isOpen ? (
        <motion.div
          key='search-bar'
          initial={{ opacity: 0, width: 160 }}
          animate={{ opacity: 1, width: 300 }}
          exit={{ opacity: 0, width: 160 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className='flex items-center gap-3 h-10 px-3.5 border border-border bg-background rounded-xl'
        >
          <Search className='size-4 text-muted-foreground/70 flex-shrink-0' strokeWidth={1.5} />
          <input
            ref={inputRef}
            type='text'
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder='Find in transcript'
            autoFocus
            className='flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 outline-none'
            data-track-category='RecordingsScreen'
            data-track-name='transcript_search_input'
          />
          {query && matchCount > 0 && (
            <span className='text-xs text-muted-foreground tabular-nums whitespace-nowrap'>
              {currentIndex + 1} of {matchCount}
            </span>
          )}
          <div className='flex items-center gap-1'>
            <button
              type='button'
              onClick={onPrevious}
              disabled={matchCount === 0}
              className='p-1 text-muted-foreground/70 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
              aria-label='Previous match'
              data-track-category='RecordingsScreen'
              data-track-name='transcript_search_previous'
            >
              <ChevronUp className='size-4' strokeWidth={1.5} />
            </button>
            <button
              type='button'
              onClick={onNext}
              disabled={matchCount === 0}
              className='p-1 text-muted-foreground/70 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
              aria-label='Next match'
              data-track-category='RecordingsScreen'
              data-track-name='transcript_search_next'
            >
              <ChevronDown className='size-4' strokeWidth={1.5} />
            </button>
          </div>
          <button
            type='button'
            onClick={onClose}
            className='p-1 text-muted-foreground/70 hover:text-foreground transition-colors'
            aria-label='Close search'
            data-track-category='RecordingsScreen'
            data-track-name='transcript_search_close'
          >
            <X className='size-4' strokeWidth={1.5} />
          </button>
        </motion.div>
      ) : (
        <motion.button
          key='find-button'
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          type='button'
          onClick={onOpen}
          className='inline-flex items-center justify-center gap-1.5 h-8 px-2.5 border border-border bg-background rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors'
          data-track-category='RecordingsScreen'
          data-track-name='find_in_transcript'
        >
          <Search className='size-3.5' strokeWidth={1.5} />
          <span>Find</span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TranscriptSkeleton - Loading state with timeline design
// ─────────────────────────────────────────────────────────────────────────────

interface TranscriptSkeletonProps {
  skeletonRows: Array<{ w1: string; w2: string | null; opacity: number }>;
  containerRef: RefObject<HTMLDivElement | null>;
}

function TranscriptSkeleton({ skeletonRows, containerRef }: TranscriptSkeletonProps): ReactElement {
  return (
    <motion.div
      key='skeleton'
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
      ref={containerRef}
      className='max-w-[840px] mx-auto h-full flex flex-col px-5 py-5'
    >
      <div className='relative flex flex-col gap-6 flex-1'>
        {skeletonRows.map((row, i) => {
          const isLast = i === skeletonRows.length - 1;
          return (
            <div
              key={i}
              className='relative flex items-start gap-8'
              style={{ opacity: row.opacity }}
            >
              <Skeleton className='flex-none w-11 h-3 rounded' />
              {!isLast && (
                <span
                  className='absolute left-[58px] top-[14px] h-[calc(100%+16px)] w-px bg-border'
                  aria-hidden='true'
                />
              )}
              <span
                className='absolute left-[55px] top-[5px] z-[1] size-[7px] rounded-full bg-muted-foreground/40'
                style={{ boxShadow: '0 0 0 2px hsl(var(--background))' }}
              />
              <div className='flex-1'>
                <Skeleton className='h-[18px] rounded' style={{ width: row.w1 }} />
                {row.w2 && <Skeleton className='h-[18px] mt-2 rounded' style={{ width: row.w2 }} />}
              </div>
            </div>
          );
        })}
      </div>

      <div className='flex-none relative'>
        <div className='absolute inset-x-0 bottom-full h-12 bg-gradient-to-t from-background to-transparent pointer-events-none' />
        <div className='flex items-center justify-center gap-2.5 pb-5 bg-background'>
          <span className='flex items-end gap-0.5 h-3.5'>
            {[0, 1, 2].map(i => (
              <span
                key={i}
                className='w-0.5 bg-destructive rounded-sm h-full origin-bottom animate-[listening-bar_1s_ease-in-out_infinite]'
                style={{ animationDelay: `${i * 0.2}s` }}
              />
            ))}
          </span>
          <span className='text-xs text-muted-foreground'>
            Listening for audio — the transcript will appear here as people speak.
          </span>
        </div>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ActiveRecordingView - Main component
// ─────────────────────────────────────────────────────────────────────────────

interface ActiveRecordingViewProps {
  /** Live transcript entries */
  transcripts: TranscriptEntry[];
  /** Recording start timestamp for elapsed time calculations */
  startTime: number | null;
  /** Whether the recording is paused */
  isPaused: boolean;
}

export function ActiveRecordingView({
  transcripts,
  startTime,
  isPaused,
}: ActiveRecordingViewProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const skeletonContainerRef = useRef<HTMLDivElement>(null);
  const hasInitialScrollRef = useRef(false);
  const [skeletonContainerHeight, setSkeletonContainerHeight] = useState(0);

  // Text search functionality
  const getTranscriptText = useCallback((entry: TranscriptEntry) => entry.text, []);
  const search = useTextSearch({ items: transcripts, getText: getTranscriptText });

  // Track skeleton container height for dynamic row generation
  useEffect(() => {
    const container = skeletonContainerRef.current;
    if (!container || transcripts.length > 0) return;

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) {
        setSkeletonContainerHeight(entry.contentRect.height);
      }
    });

    observer.observe(container);
    return (): void => observer.disconnect();
  }, [transcripts.length]);

  // Generate skeleton rows based on available height
  const skeletonRows = useMemo(() => {
    const availableHeight = skeletonContainerHeight - LISTENING_INDICATOR_HEIGHT;
    const rowCount = Math.max(
      3,
      Math.floor((availableHeight + SKELETON_ROW_GAP) / (SKELETON_ROW_HEIGHT + SKELETON_ROW_GAP)),
    );

    return Array.from({ length: rowCount }, (_, i) => {
      const pattern = SKELETON_WIDTH_PATTERNS[i % SKELETON_WIDTH_PATTERNS.length]!;
      return {
        w1: pattern.w1,
        w2: pattern.w2,
        opacity: 1 - (i / rowCount) * 0.95,
      };
    });
  }, [skeletonContainerHeight]);

  // Auto-scroll to bottom when new transcripts arrive (disabled during search)
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || transcripts.length === 0) return;
    // Don't auto-scroll when user is searching - they're viewing specific matches
    if (search.isOpen) return;

    el.scrollTo({
      top: el.scrollHeight,
      behavior: hasInitialScrollRef.current ? 'smooth' : 'auto',
    });
    hasInitialScrollRef.current = true;
  }, [transcripts, search.isOpen]);

  // Cmd+F / Ctrl+F keyboard shortcut to open search
  useEffect(() => {
    if (transcripts.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent): void => {
      // non blocking default behavior for and contenteditable elements
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) {
        return;
      }

      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const isFindShortcut = e.key === 'f' && (isMac ? e.metaKey : e.ctrlKey);

      if (isFindShortcut) {
        e.preventDefault();
        search.open();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return (): void => document.removeEventListener('keydown', handleKeyDown);
  }, [transcripts.length, search]);

  return (
    <div className='flex flex-col h-full relative overflow-hidden'>
      {/* Transcript Sub-header */}
      <div className='pointer-events-none absolute inset-x-0 top-0 z-30 h-16 px-5 pt-3'>
        <div
          className='absolute inset-0 bg-gradient-to-b from-background from-0% via-background/85 via-45% to-background [mask-image:linear-gradient(to_bottom,black_0%,black_45%,rgba(0,0,0,0.5)_62%,transparent_82%)] [-webkit-mask-image:linear-gradient(to_bottom,black_0%,black_45%,rgba(0,0,0,0.5)_62%,transparent_82%)]'
          aria-hidden='true'
        />
        <div className='pointer-events-auto relative flex items-center justify-between'>
          <div className='flex items-center gap-2 text-xs font-semibold text-muted-foreground tracking-wide uppercase'>
            Transcript
          </div>
          {transcripts.length > 0 && (
            <TranscriptSearchBar
              isOpen={search.isOpen}
              query={search.query}
              matchCount={search.matchCount}
              currentIndex={search.currentIndex}
              onQueryChange={search.setQuery}
              onNext={search.goToNext}
              onPrevious={search.goToPrevious}
              onClose={search.close}
              onOpen={search.open}
              onKeyDown={search.handleKeyDown}
            />
          )}
        </div>
      </div>

      {/* Transcript Area */}
      <div
        ref={scrollRef}
        className={`flex-1 px-5 pt-14 pb-5 relative ${
          transcripts.length > 0 ? 'overflow-auto' : 'overflow-hidden'
        }`}
        aria-live='polite'
      >
        <AnimatePresence mode='wait'>
          {transcripts.length > 0 ? (
            <motion.div
              key='transcripts'
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className='max-w-[840px] mx-auto'
            >
              <div className='relative flex flex-col gap-6'>
                {transcripts.map((entry, index) => {
                  const isLast = index === transcripts.length - 1;
                  const isLive = isLast && !isPaused;

                  return (
                    <motion.div
                      key={entry.id}
                      className='relative flex items-start gap-3'
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.15, delay: 0.1 }}
                    >
                      {/* Time label */}
                      <motion.div
                        className='flex-none w-11 flex justify-end font-mono text-xs font-medium text-muted-foreground/60 tabular-nums leading-[25px]'
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.15, delay: 0.1 }}
                      >
                        <span className='shrink-0 whitespace-nowrap text-right'>
                          {startTime !== null &&
                            formatElapsedTime(Math.max(0, entry.timestamp - startTime))}
                        </span>
                      </motion.div>

                      {/* Timeline dot container - maintains vertical alignment */}
                      <div className='relative flex-none w-[7px] self-stretch flex items-start justify-center'>
                        {/* Timeline rail segment */}
                        {!isLast && (
                          <span
                            className='absolute left-1/2 top-[13px] -translate-x-1/2 h-[calc(100%+22px)] w-px bg-border'
                            aria-hidden='true'
                          />
                        )}
                        {/* Timeline dot */}
                        {isLive ? (
                          <motion.span
                            className='relative z-[1] size-[7px] rounded-full bg-destructive mt-[9px]'
                            style={{
                              boxShadow:
                                '0 0 0 2px hsl(var(--background)), 0 0 0 5px hsl(var(--destructive) / 0.15)',
                            }}
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ duration: 0.15, delay: 0.05, ease: 'easeOut' }}
                          />
                        ) : (
                          <motion.span
                            className='relative z-[1] size-[7px] rounded-full bg-border mt-[9px]'
                            style={{ boxShadow: '0 0 0 2px hsl(var(--background))' }}
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ duration: 0.15, delay: 0.05, ease: 'easeOut' }}
                          />
                        )}
                      </div>

                      {/* Transcript text */}
                      <motion.div
                        className='flex-1 text-[15px] leading-[25px] text-foreground'
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.2, delay: 0.12 }}
                      >
                        <HighlightedText
                          text={entry.text}
                          matches={search.matches}
                          itemIndex={index}
                          currentMatchIndex={search.currentIndex}
                          matchRefs={search.matchRefs}
                        />
                      </motion.div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          ) : (
            <TranscriptSkeleton skeletonRows={skeletonRows} containerRef={skeletonContainerRef} />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
