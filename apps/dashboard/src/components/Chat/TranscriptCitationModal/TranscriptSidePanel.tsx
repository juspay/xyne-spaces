import { Fragment, useCallback, useEffect, useMemo, useRef, type ReactElement } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ChevronDown,
  ChevronUp,
  CopyDefault,
  DownloadDown,
  MultipleCrossCancelDefault,
  SearchBig,
  Spinner,
} from '@xyne/icons';
import { toast } from 'sonner';
import { Button } from '../../ui/Button/Button';
import { Tooltip } from '../../ui/Tooltip';
import { MarkedMomentDivider } from '../../Notetaker/MarkedMomentDivider';
import { useTextSearch } from '../../../hooks/useTextSearch';
import { HighlightedText } from '../../../routes/RecordingsScreen/components/HighlightedText';
import { cn } from '../../../utils/classNames';
import {
  CITATION_HIGHLIGHT,
  findTargetIndex,
  MARKER_HIGHLIGHT,
  markedMomentLineIndices,
  parseTranscript,
  type TranscriptLine,
} from './transcriptCache';

/** Stable identity so the memos below don't recompute for callers passing no moments. */
const NO_MARKED_MOMENTS: readonly number[] = [];

/**
 * Which treatment the resolved line gets. `marker` is the amber one, for a line
 * reached from a decision/action marker on the recording timeline; `citation` is the
 * neutral default used by canvas citations and the plain "open transcript" button.
 */
export type TranscriptTargetHighlight = 'citation' | 'marker';

export interface TranscriptPanelTarget {
  timestamp?: string;
  speaker?: string;
  segment?: string | number;
  timestampSeconds?: number;
  highlight?: TranscriptTargetHighlight;
}

export interface TranscriptSidePanelProps {
  transcript: string;
  target?: TranscriptPanelTarget | null;
  openNonce?: number;
  isLoading?: boolean;
  error?: string | null;
  /**
   * Offsets, in seconds from the recording start, the user flagged while recording —
   * the `moment` entries of Call.markedItems. Each is resolved to the line being
   * spoken at that point and drawn as a divider above it.
   */
  markedTimestampsSeconds?: readonly number[];
  onClose: () => void;
  className?: string;
}

export function TranscriptSidePanel({
  transcript,
  target,
  openNonce = 0,
  isLoading = false,
  error = null,
  markedTimestampsSeconds = NO_MARKED_MOMENTS,
  onClose,
  className = '',
}: TranscriptSidePanelProps): ReactElement {
  const lineRefs = useRef(new Map<number, HTMLDivElement>());
  const lines = useMemo(() => parseTranscript(transcript), [transcript]);
  const targetIndex = useMemo(
    () => findTargetIndex(lines, target?.segment, target?.timestamp, target?.timestampSeconds),
    [lines, target?.segment, target?.timestamp, target?.timestampSeconds],
  );
  const markedIndices = useMemo(
    () => markedMomentLineIndices(lines, markedTimestampsSeconds),
    [lines, markedTimestampsSeconds],
  );
  const targetHighlight = target?.highlight === 'marker' ? MARKER_HIGHLIGHT : CITATION_HIGHLIGHT;

  // Unparseable lines keep their raw text, so they stay searchable and readable.
  const getLineText = useCallback((line: TranscriptLine): string => line.text ?? line.raw, []);
  const search = useTextSearch({ items: lines, getText: getLineText });

  const { close: closeSearch } = search;
  useEffect(() => {
    if (targetIndex < 0) return;
    closeSearch();
  }, [targetIndex, openNonce, closeSearch]);

  useEffect(() => {
    if (targetIndex < 0) return;
    const frame = window.requestAnimationFrame(() => {
      lineRefs.current.get(targetIndex)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [targetIndex, openNonce]);

  const handleCopy = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(transcript);
      toast.success('Transcript copied');
    } catch {
      toast.error('Could not copy the transcript');
    }
  }, [transcript]);

  const handleDownload = useCallback((): void => {
    const blob = new Blob([transcript], { type: 'text/plain;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = 'transcript.txt';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 0);
  }, [transcript]);

  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.aside
      aria-label='Transcript'
      className={cn(
        'flex h-full w-full flex-col overflow-hidden border-l border-border/70 bg-background shadow-2xl',
        className,
      )}
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={
        shouldReduceMotion ? { duration: 0.15 } : { type: 'spring', stiffness: 380, damping: 34 }
      }
    >
      <header className='flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3'>
        <h2 className='truncate text-base font-semibold text-foreground'>Transcript</h2>
        <div className='flex shrink-0 items-center gap-1'>
          <Tooltip content='Copy transcript' side='bottom'>
            <Button
              type='button'
              variant='ghost'
              size='iconSm'
              onClick={() => void handleCopy()}
              className='text-muted-foreground hover:bg-muted hover:text-foreground rounded-xl'
              aria-label='Copy transcript'
              data-track-category='TranscriptPanel'
              data-track-name='copy_transcript'
            >
              <CopyDefault size={16} aria-hidden='true' />
            </Button>
          </Tooltip>
          <Tooltip content='Download transcript' side='bottom'>
            <Button
              type='button'
              variant='ghost'
              size='iconSm'
              onClick={handleDownload}
              className='text-muted-foreground hover:bg-muted hover:text-foreground rounded-xl'
              aria-label='Download transcript'
              data-track-category='TranscriptPanel'
              data-track-name='download_transcript'
            >
              <DownloadDown size={16} aria-hidden='true' />
            </Button>
          </Tooltip>
          <Tooltip content='Close transcript' side='bottom'>
            <Button
              type='button'
              variant='ghost'
              size='iconSm'
              onClick={onClose}
              className='text-muted-foreground hover:bg-muted hover:text-foreground rounded-xl'
              aria-label='Close transcript'
              data-track-category='TranscriptPanel'
              data-track-name='close_transcript'
            >
              <MultipleCrossCancelDefault size={16} aria-hidden='true' />
            </Button>
          </Tooltip>
        </div>
      </header>

      <div className='shrink-0 border-b border-border px-4 py-3'>
        <div className='flex h-10 items-center gap-1.5 rounded-xl border border-border bg-muted/45 px-3 text-muted-foreground focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20'>
          <SearchBig size={16} strokeWidth={2.2} className='shrink-0' aria-hidden='true' />
          <input
            type='text'
            value={search.query}
            onFocus={search.open}
            onChange={event => search.setQuery(event.target.value)}
            onKeyDown={search.handleKeyDown}
            placeholder='Search transcript...'
            aria-label='Search transcript'
            className='h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground'
            data-track-category='TranscriptPanel'
            data-track-name='search_transcript'
          />
          {search.query ? (
            <>
              <span className='shrink-0 text-xs tabular-nums'>
                {search.matchCount > 0
                  ? `${search.currentIndex + 1} of ${search.matchCount}`
                  : 'No matches'}
              </span>
              <Button
                type='button'
                variant='ghost'
                size='iconSm'
                onClick={search.goToPrevious}
                disabled={search.matchCount === 0}
                className='size-6 rounded-full hover:bg-muted disabled:opacity-35'
                aria-label='Previous match'
                data-track-category='TranscriptPanel'
                data-track-name='transcript_search_previous'
              >
                <ChevronUp className='size-3.5' aria-hidden='true' />
              </Button>
              <Button
                type='button'
                variant='ghost'
                size='iconSm'
                onClick={search.goToNext}
                disabled={search.matchCount === 0}
                className='size-6 rounded-full hover:bg-muted disabled:opacity-35'
                aria-label='Next match'
                data-track-category='TranscriptPanel'
                data-track-name='transcript_search_next'
              >
                <ChevronDown className='size-3.5' aria-hidden='true' />
              </Button>
              <Button
                type='button'
                variant='ghost'
                size='iconSm'
                onClick={search.close}
                className='size-6 rounded-full hover:bg-muted'
                aria-label='Clear transcript search'
                data-track-category='TranscriptPanel'
                data-track-name='clear_transcript_search'
              >
                <MultipleCrossCancelDefault className='size-3.5' aria-hidden='true' />
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className='thin-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-3'>
        {isLoading ? (
          <div
            className='flex items-center gap-2 py-6 text-sm text-muted-foreground'
            aria-live='polite'
          >
            <Spinner size={16} className='animate-spin' aria-hidden='true' />
            Loading transcript
          </div>
        ) : null}
        {!isLoading && error ? <p className='py-6 text-sm text-destructive'>{error}</p> : null}
        {!isLoading && !error && lines.length === 0 ? (
          <p className='py-6 text-sm text-muted-foreground'>
            No transcript is available for this call.
          </p>
        ) : null}
        {!isLoading && !error && lines.length > 0 ? (
          <div className='space-y-2.5'>
            {lines.map((line, index) => (
              <Fragment key={index}>
                {markedIndices.has(index) && <MarkedMomentDivider />}
                <div
                  ref={element => {
                    if (element) lineRefs.current.set(index, element);
                    else lineRefs.current.delete(index);
                  }}
                  className={cn(
                    // Negative inline margin bleeds the highlight past the reading
                    // column, so a cited line reads as a band rather than a chip.
                    '-mx-3 rounded-lg px-3 py-2.5 transition-colors',
                    index === targetIndex ? targetHighlight : 'hover:bg-muted/40',
                  )}
                >
                  {line.timestamp ? (
                    <span className='mb-0.5 block font-mono text-xs text-muted-foreground'>
                      {line.timestamp}
                    </span>
                  ) : null}
                  <p className='text-sm leading-relaxed text-foreground/90'>
                    <HighlightedText
                      text={getLineText(line)}
                      matches={search.matches}
                      itemIndex={index}
                      currentMatchIndex={search.currentIndex}
                      matchRefs={search.matchRefs}
                      currentMatchClassName='bg-primary text-background [[data-theme=midnight]_&]:text-foreground py-0.5'
                      otherMatchClassName='bg-yellow-200 [[data-theme=midnight]_&]:bg-yellow-300 text-yellow-950 py-0.5'
                    />
                  </p>
                </div>
              </Fragment>
            ))}
          </div>
        ) : null}
      </div>
    </motion.aside>
  );
}
