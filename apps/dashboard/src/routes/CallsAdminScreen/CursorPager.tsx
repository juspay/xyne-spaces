import type { ReactElement } from 'react';
import { ArrowLeft, ArrowRight } from '@xyne/icons';
import { Button } from '@/components/ui/Button';
import { CALLS_ADMIN_TRACK } from './CallsAdminScreen.utils';
import type { CursorPages } from './useCursorPages';

/**
 * Prev/next for the cursor-paged admin lists. AdminPager needs a total, which a
 * cursor list doesn't have, so this shows the page number instead.
 */
export function CursorPager({
  pages,
  nextCursor,
  trackPrefix,
}: {
  pages: CursorPages;
  nextCursor: string | null;
  trackPrefix: string;
}): ReactElement | null {
  if (!pages.hasPrev && !nextCursor) return null;

  return (
    <div className='flex shrink-0 items-center justify-between pb-4 text-xs text-muted-foreground'>
      <span>Page {pages.page}</span>
      <div className='flex items-center gap-2'>
        <Button
          type='button'
          variant='outline'
          onClick={pages.prev}
          disabled={!pages.hasPrev}
          data-track-category={CALLS_ADMIN_TRACK}
          data-track-name={`${trackPrefix}: previous page`}
          className='disabled:pointer-events-auto'
        >
          <ArrowLeft className='size-4' aria-hidden />
          Prev
        </Button>
        <Button
          type='button'
          variant='outline'
          onClick={() => {
            if (nextCursor) pages.next(nextCursor);
          }}
          disabled={!nextCursor}
          data-track-category={CALLS_ADMIN_TRACK}
          data-track-name={`${trackPrefix}: next page`}
          className='disabled:pointer-events-auto'
        >
          Next
          <ArrowRight className='size-4' aria-hidden />
        </Button>
      </div>
    </div>
  );
}
