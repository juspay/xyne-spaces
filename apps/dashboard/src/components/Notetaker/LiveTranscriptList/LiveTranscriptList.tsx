/**
 * The streaming transcript of an in-progress recording.
 *
 * Rendered on two surfaces — the floating note-taker overlay and the recording detail
 * screen — which share the data (recordingStore transcripts + marked moments), the
 * highlight-and-navigate search, and the marked-moment anchoring rule. They differ
 * only in density and in who owns the scrolling, which is what `variant` selects.
 *
 * Not to be confused with TranscriptSidePanel: that renders a *finished* transcript
 * parsed from stored text, and filters rather than highlights as you search.
 */

import { Fragment, useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { ChevronDown, ChevronUp, Flag, MultipleCrossCancelDefault, SearchBig } from '@xyne/icons';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Button } from '../../ui/Button/Button';
import Input from '../../ui/Input';
import { useTextSearch } from '../../../hooks/useTextSearch';
import { cn } from '../../../utils/classNames';
import { formatElapsedTime } from '../../../utils/recordingUtils';
import type { TranscriptEntry } from '../../../stores/recordingStore';
import { HighlightedText } from '../../../routes/RecordingsScreen/components/HighlightedText';
import type { LiveTranscriptListProps } from './LiveTranscriptList.types';
import { findScrollParent, markedMomentAnchors, VARIANT_STYLES } from './LiveTranscriptList.utils';

/** How close to the bottom still counts as "following the latest line". */
const FOLLOW_THRESHOLD_PX = 40;

/** Inline separator marking the transcript line the user flagged. */
const MarkedMomentDivider = (): ReactElement => (
  <div className='flex items-center gap-2' role='separator' aria-label='Marked moment'>
    <span
      className='flex size-5 shrink-0 items-center justify-center rounded-md bg-destructive/10'
      aria-hidden='true'
    >
      <Flag size={11} strokeWidth={2.5} className='text-primary' />
    </span>
    <span className='shrink-0 text-xs font-semibold uppercase tracking-wide text-primary'>
      Marked moment
    </span>
    <span className='h-px flex-1 bg-destructive/20' aria-hidden='true' />
  </div>
);

export const LiveTranscriptList = ({
  transcripts,
  markedMoments,
  isPaused,
  variant,
  isScrollSuspended = false,
  trackCategory,
  className,
}: LiveTranscriptListProps): ReactElement => {
  const styles = VARIANT_STYLES[variant];
  const isPanel = variant === 'panel';
  const shouldReduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  /** The panel's own scrolling viewport; null on the page variant. */
  const viewportRef = useRef<HTMLDivElement>(null);
  /** The host scroller the page variant was rendered into; null on the panel variant. */
  const pageViewportRef = useRef<HTMLElement | null>(null);
  const [isFollowing, setIsFollowing] = useState(true);
  const getTranscriptText = useCallback((entry: TranscriptEntry) => entry.text, []);
  const search = useTextSearch({ items: transcripts, getText: getTranscriptText });
  const { markedTranscriptIds, hasLeadingMoment } = markedMomentAnchors(markedMoments);
  const firstSpokenAt = transcripts[0]?.spokenAt;

  const getViewport = useCallback(
    (): HTMLElement | null => (isPanel ? viewportRef.current : pageViewportRef.current),
    [isPanel],
  );

  const updateIsFollowing = useCallback((viewport: HTMLElement): void => {
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    setIsFollowing(distanceFromBottom <= FOLLOW_THRESHOLD_PX);
  }, []);

  const scrollToCurrent = useCallback(
    (behavior: ScrollBehavior = 'smooth'): void => {
      const viewport = getViewport();
      if (!viewport) return;
      viewport.scrollTo({ top: viewport.scrollHeight, behavior });
    },
    [getViewport],
  );

  /**
   * The page variant does not render a viewport of its own, so it adopts the host's
   * scroller. Runs before the auto-scroll effect below, which needs the result.
   */
  useEffect(() => {
    if (isPanel) return;
    const viewport = findScrollParent(rootRef.current);
    pageViewportRef.current = viewport;
    if (!viewport) return;

    const handleHostScroll = (): void => updateIsFollowing(viewport);
    viewport.addEventListener('scroll', handleHostScroll, { passive: true });
    return (): void => viewport.removeEventListener('scroll', handleHostScroll);
  }, [isPanel, updateIsFollowing]);

  /** Auto-scroll to the latest transcript entry when following is active. */
  useEffect(() => {
    if (isScrollSuspended || !isFollowing || search.query.trim()) return;
    scrollToCurrent('auto');
  }, [isScrollSuspended, isFollowing, scrollToCurrent, search.query, transcripts]);

  const handleScroll = (): void => {
    const viewport = viewportRef.current;
    if (viewport) updateIsFollowing(viewport);
  };

  const entries = (
    <>
      {transcripts.length > 0 && (
        <div className={styles.list}>
          {hasLeadingMoment && <MarkedMomentDivider />}
          {transcripts.map((entry, index) => (
            <Fragment key={entry.id}>
              {markedTranscriptIds.has(entry.id) && <MarkedMomentDivider />}
              <div className='group relative'>
                {/* Sits in the gap above the block so revealing it shifts nothing. */}
                {!isPanel && firstSpokenAt !== undefined && (
                  <span className='pointer-events-none absolute -top-4 left-0 font-mono text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-50'>
                    {formatElapsedTime(Math.max(0, entry.spokenAt - firstSpokenAt))}
                  </span>
                )}
                <p>
                  <HighlightedText
                    text={entry.text}
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
      )}

      {/* Liveness cue for the floating panel, where the recording controls are the only
          other sign the session is running. The detail screen has its own live header
          and control bar, so the ticker would only repeat what is already on screen. */}
      {isPanel && (
        <div className={cn(styles.ticker, transcripts.length === 0 && 'mt-auto')}>
          <span
            className='relative h-4 w-0.5 shrink-0 overflow-hidden rounded-full bg-muted'
            aria-hidden='true'
          >
            <span
              className={cn(
                'absolute inset-0 motion-reduce:animate-none',
                isPaused
                  ? 'bg-muted'
                  : 'animate-[rec-blink_800ms_steps(1,end)_infinite] bg-primary',
              )}
            />
          </span>
          <span>{isPaused ? 'paused' : 'transcribing...'}</span>
        </div>
      )}
    </>
  );

  return (
    <div ref={rootRef} className={cn(styles.root, className)}>
      <div className={styles.searchWrapper}>
        <div className={styles.searchField}>
          <SearchBig
            size={styles.searchIconSize}
            strokeWidth={2.2}
            className='shrink-0 text-muted-foreground/75'
          />
          <Input
            type='text'
            value={search.query}
            onFocus={search.open}
            onChange={event => search.setQuery(event.target.value)}
            onKeyDown={search.handleKeyDown}
            placeholder={isPanel ? 'Search transcript…' : 'Search the live transcript…'}
            className={styles.searchInput}
            aria-label='Search transcript'
            data-track-category={trackCategory}
            data-track-name='transcript_search_input'
          />
          {search.query && (
            <>
              <span className={styles.searchCounter}>
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
                className={styles.searchButton}
                aria-label='Previous match'
                data-track-category={trackCategory}
                data-track-name='transcript_search_previous'
              >
                <ChevronUp size={14} />
              </Button>
              <Button
                type='button'
                variant='ghost'
                size='iconSm'
                onClick={search.goToNext}
                disabled={search.matchCount === 0}
                className={styles.searchButton}
                aria-label='Next match'
                data-track-category={trackCategory}
                data-track-name='transcript_search_next'
              >
                <ChevronDown size={14} />
              </Button>
              <Button
                type='button'
                variant='ghost'
                size='iconSm'
                onClick={search.close}
                className={cn(styles.searchButton, 'disabled:opacity-100')}
                aria-label='Clear transcript search'
                data-track-category={trackCategory}
                data-track-name='transcript_search_clear'
              >
                <MultipleCrossCancelDefault className='size-3' />
              </Button>
            </>
          )}
        </div>
      </div>

      {isPanel ? (
        <div className='relative min-h-0 flex-1 overflow-hidden'>
          <div
            ref={viewportRef}
            onScroll={handleScroll}
            className='thin-scrollbar h-full scroll-smooth overflow-y-auto px-4 pb-5'
          >
            <div className='flex min-h-full flex-col'>{entries}</div>
          </div>

          <AnimatePresence>
            {!isScrollSuspended && !isFollowing && transcripts.length > 0 && (
              <motion.div
                initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                transition={{ duration: shouldReduceMotion ? 0 : 0.12 }}
                className='pointer-events-none absolute inset-x-0 bottom-3 flex justify-center'
              >
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={() => scrollToCurrent()}
                  className='pointer-events-auto flex h-7 items-center gap-1.5 rounded-full border border-border/70 bg-foreground px-3 text-xs font-medium text-background shadow-lg backdrop-blur-sm outline-none transition-colors hover:text-background'
                  data-track-category={trackCategory}
                  data-track-name='return_to_current'
                >
                  Return to current
                  <ChevronDown size={13} strokeWidth={2.5} />
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        entries
      )}
    </div>
  );
};

export default LiveTranscriptList;
