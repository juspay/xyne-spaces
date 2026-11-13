import { useEffect, useRef } from 'react';
import { cn } from './cn.js';

export interface LoadMoreProps {
  hasMore: boolean;
  isLoading?: boolean | undefined;
  /** Fetch the next page. Called automatically when the sentinel scrolls into
   *  view (unless {@link LoadMoreProps.autoLoad} is false). */
  onClick: () => void;
  /** Rows shown so far, rendered in the status line when given. */
  shown?: number | undefined;
  /** Omit rather than guessing when no count is available. */
  total?: number | undefined;
  /** What the rows are, for the count line. Defaults to "items". */
  noun?: string | undefined;
  className?: string | undefined;
  /**
   * Auto-fetch the next page when the sentinel nears the viewport. Default true.
   *
   * Set false when the surrounding list already reports reaching its end (a
   * virtualized `EntryList`/`EntryGrid` via `onReachEnd`): the sentinel would sit
   * outside that list's own scroll area and fire constantly, so there this only
   * renders the status footer while the list drives loading.
   */
  autoLoad?: boolean | undefined;
}

/**
 * Infinite-scroll footer. The next page loads automatically as the bottom of the
 * list comes into view — there is no button to click. A hidden sentinel drives
 * this via IntersectionObserver, with a little `rootMargin` so the fetch starts
 * just before the true bottom and scrolling stays seamless.
 */
export function LoadMore({
  hasMore,
  isLoading,
  onClick,
  shown,
  total,
  noun = 'items',
  className,
  autoLoad = true,
}: LoadMoreProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Keep the latest onClick without re-subscribing the observer every render.
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  useEffect(() => {
    if (!autoLoad || !hasMore || isLoading) return;
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onClickRef.current();
      },
      { rootMargin: '240px 0px' },
    );
    io.observe(el);
    return () => { io.disconnect(); };
  }, [autoLoad, hasMore, isLoading]);

  if (!hasMore && shown === undefined) return null;

  return (
    <div
      className={cn(
        'mt-4 flex items-center justify-between text-xs text-[var(--wui-fg-muted)]',
        className,
      )}
    >
      <span>
        {shown === undefined
          ? null
          : total === undefined
            ? `${shown} ${noun}`
            : `Showing ${shown} of ${total} ${noun}`}
      </span>
      {hasMore && (
        <span className="inline-flex items-center gap-1.5">
          {/* Invisible tripwire: entering the viewport auto-loads the next page. */}
          <span ref={sentinelRef} aria-hidden className="pointer-events-none block h-px w-px" />
          {isLoading && (
            <>
              <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z" />
              </svg>
              <span>Loading more…</span>
            </>
          )}
        </span>
      )}
    </div>
  );
}
