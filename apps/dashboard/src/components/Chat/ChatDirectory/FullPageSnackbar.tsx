import { ReactElement, useEffect, useRef } from 'react';
import { Minimize2, X } from 'lucide-react';

// Long enough to read the sentence and find the icon it points at (the design allows 6–8s).
const AUTO_DISMISS_MS = 7000;

interface FullPageSnackbarProps {
  /** Put the default back to the modal. */
  onUndo: () => void;
  /** Closed with × or timed out. */
  onDismiss: () => void;
}

/**
 * "Search now opens in full page", shown once on the first open after Cmd+K switches its default
 * to full page. Anchored under the results page's collapse button and pointing at it, since that
 * button is how to get the modal back.
 */
export function FullPageSnackbar({ onUndo, onDismiss }: FullPageSnackbarProps): ReactElement {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  useEffect(() => {
    const timer = setTimeout(() => onDismissRef.current(), AUTO_DISMISS_MS);
    return (): void => clearTimeout(timer);
  }, []);

  return (
    <div
      role='status'
      data-full-page-snackbar='true'
      className='absolute top-full right-0 mt-2.5 z-40 w-[340px] flex items-start gap-3 rounded-xl bg-foreground text-background px-3.5 py-3 text-[13.5px] leading-normal shadow-[0_10px_30px_rgba(0,0,0,0.2)]'
    >
      {/* Pointer at the collapse button above. */}
      <span className='absolute -top-1.5 right-2 size-3 rotate-45 rounded-[2px] bg-foreground' />
      <span className='flex-1 min-w-0 text-pretty'>
        <span className='font-semibold'>Search now opens in full page.</span> Prefer the popup view?
        Use{' '}
        <span className='inline-grid place-items-center size-5 rounded-[5px] bg-background/15 align-[-5px]'>
          <Minimize2 size={12} />
        </span>{' '}
        to switch back to the modal.
      </span>
      <span className='flex items-center gap-1 shrink-0'>
        <button
          type='button'
          onClick={onUndo}
          className='px-1.5 py-0.5 rounded-md font-semibold text-background hover:bg-background/15'
          data-track-category='SEARCH_RESULTS'
          data-track-name='FULL_PAGE_SNACKBAR_UNDO'
        >
          Undo
        </button>
        <button
          type='button'
          aria-label='Dismiss'
          onClick={onDismiss}
          className='p-0.5 rounded-md text-background/60 hover:text-background'
          data-track-category='SEARCH_RESULTS'
          data-track-name='FULL_PAGE_SNACKBAR_DISMISS'
        >
          <X size={14} />
        </button>
      </span>
    </div>
  );
}
