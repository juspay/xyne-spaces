import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../utils/classNames';
import { logger, Event as LogEvent } from '../../utils/logger';
import { useAuthContextValues } from '../../hooks/useAuth';
import { apiInstance } from '../../services/clients/apiClient';

/**
 * Search feedback UI: a view inside the Cmd+K palette and a popover on the search results
 * page. Both use the same form. The backend decides which channel and group to post to.
 */

/** Same limit as the backend. */
const MAX_FEEDBACK_LENGTH = 2000;

/** Where the feedback was sent from. Must match the backend's allowed values. */
type SearchFeedbackSource = 'cmdk' | 'search_results';

/** Channel and group the feedback will be posted to (configured per workspace). */
interface SearchFeedbackTarget {
  channelName: string | null;
  groupHandle: string | null;
}

/**
 * Fetches the destination for the "Posts to …" line. Cached per workspace. Only used for
 * display: if it fails, the form shows generic text and posting still works.
 */
function useSearchFeedbackTarget(): SearchFeedbackTarget | null {
  const { workspaceId } = useAuthContextValues();
  const { data } = useQuery({
    queryKey: ['search-feedback-target', workspaceId],
    queryFn: async (): Promise<SearchFeedbackTarget> => {
      const res = await apiInstance.get<{ data: SearchFeedbackTarget }>('/search-feedback/target');
      return res.data.data;
    },
    staleTime: Infinity,
    retry: false,
  });
  return data ?? null;
}

interface SearchFeedbackFormProps {
  /** Current search query. Sent with the feedback, not shown in the form. */
  query: string;
  /** Active filter labels, e.g. `@Ch`, `from:alice`, `"ab"`. */
  filters: string[];
  /** Sort label. Only the search results page has one. */
  sort?: string;
  source: SearchFeedbackSource;
  /** Called after a successful post. */
  onPosted: () => void;
  /** Textarea size classes; Cmd+K and the popover size it differently. */
  textareaClassName?: string;
  /** Tracking category for the Post button. */
  trackCategory: string;
  /** Extra classes for the Post button. */
  postButtonClassName?: string;
  /** Lays out the form body and Post button inside the caller's header/footer. */
  children: (parts: { body: ReactNode; postButton: ReactNode }) => ReactElement;
}

/** Form shared by both surfaces: textarea, destination line, Post button and submit logic. */
const SearchFeedbackForm = ({
  query,
  filters,
  sort,
  source,
  onPosted,
  textareaClassName,
  trackCategory,
  postButtonClassName,
  children,
}: SearchFeedbackFormProps): ReactElement => {
  const [feedback, setFeedback] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const target = useSearchFeedbackTarget();

  // Focus the textarea when the form opens.
  useEffect(() => {
    const id = requestAnimationFrame((): void => textareaRef.current?.focus());
    return (): void => cancelAnimationFrame(id);
  }, []);

  // Post needs something to report: a search query or a comment. Disabled only when both are empty.
  const canPost = (query.trim() !== '' || feedback.trim() !== '') && !isPosting;

  const post = (): void => {
    if (!canPost) return;
    setIsPosting(true);
    void (async (): Promise<void> => {
      try {
        await apiInstance.post('/search-feedback', {
          query,
          feedback: feedback.trim(),
          filters,
          ...(sort ? { sort } : {}),
          source,
        });
        toast.success('Feedback posted');
        onPosted();
      } catch (error) {
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'search_feedback_submit_failed',
          message: 'Failed to submit search feedback',
          error,
        });
        toast.error('Could not post feedback. Please try again.');
      } finally {
        setIsPosting(false);
      }
    })();
  };

  const body = (
    <>
      <textarea
        ref={textareaRef}
        value={feedback}
        maxLength={MAX_FEEDBACK_LENGTH}
        onChange={(e): void => setFeedback(e.target.value)}
        data-track-category='SEARCH_FEEDBACK'
        data-track-name='TYPE_FEEDBACK'
        onKeyDown={(e): void => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            post();
          }
        }}
        placeholder='What did you expect to find?'
        disabled={isPosting}
        data-testid='search-feedback-input'
        className={cn(
          'w-full rounded-xl border border-border bg-transparent px-4 py-3 text-sm',
          'placeholder:text-muted-foreground resize-none outline-none',
          'focus-visible:border-ring focus-visible:ring-ring/10 focus-visible:ring-[2px]',
          'disabled:opacity-50 disabled:cursor-not-allowed transition-[color,box-shadow]',
          textareaClassName,
        )}
      />
      {/* `shrink-0` keeps this line from being squeezed when the textarea grows. */}
      <p
        className='mt-3 shrink-0 text-sm text-muted-foreground'
        data-testid='search-feedback-destination'
      >
        {/* `trim()` so an empty name doesn't render a bare `#`. */}
        {target?.channelName?.trim() ? (
          <>
            Posts to <span className='font-semibold text-foreground'># {target.channelName}</span>
            {target.groupHandle?.trim() ? (
              <>
                {' '}
                and tags{' '}
                <span className='rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary'>
                  @{target.groupHandle}
                </span>
              </>
            ) : null}
            , with your search query and filters included.
          </>
        ) : (
          // Destination not loaded yet or unavailable; posting still works.
          <>Posts to the search team, with your search query and filters included.</>
        )}
      </p>
    </>
  );

  const postButton = (
    <button
      type='button'
      onClick={post}
      disabled={!canPost}
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-5 py-2 font-medium transition-colors',
        canPost
          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
          : 'bg-muted text-muted-foreground cursor-not-allowed',
        postButtonClassName,
      )}
      data-track-category={trackCategory}
      data-track-name='SEARCH_FEEDBACK_POST'
    >
      {isPosting && <Loader2 size={14} className='animate-spin' />}
      <span>Post</span>
      <span
        className={cn(
          'px-1.5 py-0.5 rounded text-xs leading-none',
          canPost ? 'bg-primary-foreground/20' : 'bg-background/60',
        )}
      >
        ⌘↵
      </span>
    </button>
  );

  return children({ body, postButton });
};

export interface CmdkFeedbackViewProps {
  query: string;
  filters: string[];
  /** Go back to the search results. */
  onBack: () => void;
  /** Called after a successful post; the caller closes the palette. */
  onPosted: () => void;
}

/**
 * Feedback view inside the Cmd+K palette. Replaces the results while open, the same way
 * `/chat` shows QuickDmComposer.
 */
export const CmdkFeedbackView = ({
  query,
  filters,
  onBack,
  onPosted,
}: CmdkFeedbackViewProps): ReactElement => (
  <SearchFeedbackForm
    query={query}
    filters={filters}
    source='cmdk'
    onPosted={onPosted}
    // Fills the full-screen palette on mobile; at least 200px on desktop.
    textareaClassName='flex-1 min-h-[200px]'
    trackCategory='COMMAND_MENU'
  >
    {({ body, postButton }) => (
      <div
        role='presentation'
        className='flex flex-col h-full min-h-0'
        // Keep keystrokes from reaching the palette's result navigation. Esc still closes.
        onKeyDown={(e): void => e.stopPropagation()}
        data-testid='cmdk-feedback-view'
      >
        <div className='flex items-center gap-3 px-6 py-4 border-b border-border shrink-0'>
          <button
            type='button'
            onClick={onBack}
            aria-label='Back to results'
            className='p-1.5 rounded-lg text-foreground bg-muted hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-0'
            data-track-category='COMMAND_MENU'
            data-track-name='SEARCH_FEEDBACK_BACK'
          >
            <ArrowLeft size={16} />
          </button>
          <h2 className='text-base font-semibold text-foreground'>Feedback on search</h2>
        </div>

        <div className='flex-1 min-h-0 flex flex-col px-6 py-5'>{body}</div>

        <div className='flex items-center justify-between px-6 py-4 border-t border-border shrink-0 text-sm'>
          <button
            type='button'
            onClick={onBack}
            className='flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-0'
            data-track-category='COMMAND_MENU'
            data-track-name='SEARCH_FEEDBACK_CANCEL'
          >
            <span>Back</span>
            <span className='px-1.5 py-0.5 bg-muted rounded text-xs leading-none'>esc</span>
          </button>
          {postButton}
        </div>
      </div>
    )}
  </SearchFeedbackForm>
);

export interface SearchFeedbackPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  filters: string[];
  sort?: string;
  /** The Feedback button that opens the popover. */
  children: ReactNode;
}

/** Feedback popover on the search results page, anchored to the Feedback button. */
export const SearchFeedbackPopover = ({
  open,
  onOpenChange,
  query,
  filters,
  sort,
  children,
}: SearchFeedbackPopoverProps): ReactElement => (
  <Popover.Root open={open} onOpenChange={onOpenChange}>
    <Popover.Trigger asChild>{children}</Popover.Trigger>
    <Popover.Portal>
      <Popover.Content
        align='end'
        sideOffset={8}
        collisionPadding={12}
        className={cn(
          'z-50 w-[460px] max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-popover shadow-lg',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
        )}
        data-testid='search-feedback-popover'
      >
        {/* Mount only while open, so each open starts with an empty form. */}
        {open && (
          <SearchFeedbackForm
            query={query}
            filters={filters}
            {...(sort ? { sort } : {})}
            source='search_results'
            onPosted={() => onOpenChange(false)}
            textareaClassName='min-h-[110px]'
            trackCategory='SEARCH_RESULTS'
            postButtonClassName='text-sm'
          >
            {({ body, postButton }) => (
              <div className='p-4'>
                <div className='flex items-start justify-between gap-3 mb-3'>
                  <h2 className='text-base font-semibold text-foreground'>Feedback on search</h2>
                  <Popover.Close
                    aria-label='Close'
                    className='p-1 -m-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-0'
                  >
                    <X size={16} />
                  </Popover.Close>
                </div>

                {body}

                <div className='mt-3 flex justify-end'>{postButton}</div>
              </div>
            )}
          </SearchFeedbackForm>
        )}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
);
