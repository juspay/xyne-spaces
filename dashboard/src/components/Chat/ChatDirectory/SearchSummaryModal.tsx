/**
 * SearchSummaryModal - Modal popup overlay for displaying AI-generated search summaries
 * Styled as a floating card/modal that appears on top of the results area
 */
import { ReactElement, useEffect, useMemo, useState } from 'react';
import { X, Sparkles, Loader2 } from 'lucide-react';
import { parseStreamingContent } from '../Summary';

// ============================================================================
// Type Definitions
// ============================================================================

export type SummaryModalState = 'loading' | 'streaming' | 'complete' | 'error' | 'no_messages';

interface SearchSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: SummaryModalState;
  searchQuery: string;
  rawContent: string;
  summary: string;
  keypoints: string[];
  error: string | undefined;
}

// ============================================================================
// Helper Components
// ============================================================================

const SkeletonLoader = (): ReactElement => (
  <div className='flex flex-col items-start gap-2 w-full'>
    <div className='self-stretch h-4 bg-muted rounded animate-pulse' />
    <div
      className='self-stretch h-4 bg-muted rounded animate-pulse delay-75'
      style={{ width: '90%' }}
    />
    <div
      className='self-stretch h-4 bg-muted rounded animate-pulse delay-150'
      style={{ width: '75%' }}
    />
  </div>
);

// ============================================================================
// Main Component
// ============================================================================

export const SearchSummaryModal = ({
  isOpen,
  onClose,
  state,
  searchQuery,
  rawContent,
  summary,
  keypoints,
  error,
}: SearchSummaryModalProps): ReactElement | null => {
  const [visibleChars, setVisibleChars] = useState(0);

  // Parse streaming content for display
  const streamingParsed = useMemo(() => {
    return parseStreamingContent(rawContent);
  }, [rawContent]);

  const displaySummary = state === 'complete' ? summary : streamingParsed.summary;
  const displayKeypoints = state === 'complete' ? keypoints : streamingParsed.keypoints;

  // Character reveal animation
  useEffect(() => {
    if (
      (state === 'streaming' || state === 'loading') &&
      displaySummary.length > 0 &&
      visibleChars < displaySummary.length
    ) {
      const timer = setTimeout(() => {
        const charsToReveal = Math.min(3, displaySummary.length - visibleChars);
        setVisibleChars(prev => prev + charsToReveal);
      }, 10);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [state, displaySummary.length, visibleChars]);

  useEffect(() => {
    if (rawContent === '') setVisibleChars(0);
  }, [rawContent]);

  useEffect(() => {
    if (state === 'complete') {
      setVisibleChars(displaySummary.length);
    }
  }, [state, displaySummary.length]);

  const visibleSummary = displaySummary.slice(0, visibleChars);

  if (!isOpen) return null;

  return (
    <div className='absolute inset-0 z-20 flex items-start justify-center p-3'>
      {/* Blurry backdrop */}
      <div
        className='absolute inset-0 bg-black/20 backdrop-blur-[2px]'
        onClick={onClose}
        onKeyDown={(e): void => {
          if (e.key === 'Escape' || e.key === 'Enter') onClose();
        }}
        role='button'
        tabIndex={0}
        aria-label='Close modal'
        data-track-category='GLOBAL_SEARCH'
        data-track-name='CLOSE_SUMMARY_MODAL'
      />

      {/* Modal Card */}
      <div className='relative z-10 bg-popover rounded-xl shadow-2xl border border-border w-full max-h-[90%] overflow-hidden flex flex-col mt-2'>
        {/* Header */}
        <div className='flex items-center justify-between px-4 py-3 border-b border-border shrink-0 bg-muted/50'>
          <div className='flex items-center gap-2'>
            <Sparkles className='w-5 h-5 text-purple-600' />
            <h3 className='font-semibold text-foreground'>AI Summary</h3>
          </div>
          <button
            onClick={onClose}
            className='p-1.5 rounded-md hover:bg-accent transition-colors'
            aria-label='Close summary'
            data-track-category='GLOBAL_SEARCH'
            data-track-name='CLOSE_SUMMARY_BUTTON'
          >
            <X className='w-5 h-5 text-muted-foreground' />
          </button>
        </div>

        {/* Content */}
        <div className='flex-1 overflow-y-auto p-4'>
          {/* Loading State */}
          {state === 'loading' && visibleChars === 0 && (
            <div className='space-y-4'>
              <p className='text-muted-foreground'>
                Summarizing results for &ldquo;<span className='font-medium'>{searchQuery}</span>
                &rdquo;...
              </p>
              <SkeletonLoader />
            </div>
          )}

          {/* Error State */}
          {state === 'error' && (
            <div className='bg-red-50 text-red-700 rounded-lg p-4'>
              {error || 'Failed to generate summary'}
            </div>
          )}

          {/* No Messages State */}
          {state === 'no_messages' && (
            <div className='flex flex-col items-center justify-center py-8'>
              <div className='w-14 h-14 rounded-full bg-purple-50 flex items-center justify-center mb-4'>
                <Sparkles className='w-7 h-7 text-purple-400' />
              </div>
              <p className='text-foreground text-lg font-medium text-center mb-2'>
                No messages to summarize
              </p>
              <p className='text-muted-foreground text-sm text-center max-w-sm'>
                Search for messages first, then click summarize to get an AI-generated summary of
                the results.
              </p>
            </div>
          )}

          {/* Summary Content */}
          {(state === 'streaming' || state === 'complete') && (
            <div className='space-y-4'>
              {(visibleChars > 0 || state === 'complete') && (
                <div className='text-muted-foreground leading-relaxed whitespace-pre-wrap'>
                  {state === 'complete' ? displaySummary : visibleSummary}
                  {state === 'streaming' && visibleChars < displaySummary.length && (
                    <span className='animate-pulse'>▊</span>
                  )}
                </div>
              )}

              {displayKeypoints.length > 0 && (
                <div className='space-y-3 pt-4 border-t border-border'>
                  <h4 className='text-sm font-semibold text-muted-foreground uppercase tracking-wide'>
                    Key Points
                  </h4>
                  <ul className='space-y-2'>
                    {displayKeypoints.map((point, index) => (
                      <li key={index} className='flex items-start gap-3 text-muted-foreground'>
                        <span className='text-purple-500 mt-1 shrink-0'>•</span>
                        <span
                          dangerouslySetInnerHTML={{
                            __html: point.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'),
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {state === 'streaming' && (
                <div className='flex items-center gap-2 text-sm text-muted-foreground pt-3'>
                  <Loader2 className='w-4 h-4 animate-spin' />
                  <span>Generating summary...</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SearchSummaryModal;
