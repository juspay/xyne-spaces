import { ReactElement, ReactNode, useEffect, useRef } from 'react';
import { Command } from 'cmdk';
import { Maximize2, X } from 'lucide-react';

interface ReturnBannerProps {
  /** The filter chips of the restored query, rendered the way the expand row renders them. */
  chips: ReactNode;
  queryText: string;
  /** Expand to full page, with how it was chosen (cmdk reports a click and Enter as a select). */
  onExpand: (trigger: 'click' | 'keyboard') => void;
  onDismiss: () => void;
  /** It is on screen; fired once per mount. */
  onShown: () => void;
}

/**
 * "Expand to full-page search" offered on a quick return to Cmd+K: shown in place of the expand
 * row (never both) when the user reopens the palette right after opening a result. Border-only
 * emphasis — the border pulses twice in Xyne orange, then rests; hover or keyboard selection
 * turns the border and the icon tile orange together.
 */
export function ReturnBanner({
  chips,
  queryText,
  onExpand,
  onDismiss,
  onShown,
}: ReturnBannerProps): ReactElement {
  const onShownRef = useRef(onShown);
  onShownRef.current = onShown;
  // Like the expand row: a press marks the select that follows as a click.
  const triggerRef = useRef<'click' | 'keyboard'>('keyboard');
  useEffect(() => {
    onShownRef.current();
  }, []);

  return (
    <div className='mb-4'>
      <Command.Item
        value='__return-banner__'
        data-return-banner='true'
        // It stands in for the expand row, so the palette's keyboard handling treats it the same:
        // skipped by the first-row auto-select, and Enter on it expands.
        data-show-results-item='true'
        onPointerDown={() => {
          triggerRef.current = 'click';
        }}
        onSelect={() => {
          const trigger = triggerRef.current;
          triggerRef.current = 'keyboard';
          onExpand(trigger);
        }}
        className='group flex items-center gap-3 px-3 py-2.5 rounded-xl border border-xyne-orange-500/35 bg-card cursor-pointer text-sm text-foreground animate-cmdk-banner-pulse motion-reduce:animate-none transition-colors [transition-duration:200ms] hover:border-xyne-orange-500 aria-selected:border-xyne-orange-500'
        data-track-category='SEARCH'
        data-track-name='RETURN_BANNER'
      >
        <span className='size-[30px] shrink-0 grid place-items-center rounded-lg bg-muted text-foreground/60 transition-colors duration-200 group-hover:bg-xyne-orange-500/10 group-hover:text-xyne-orange-500 group-aria-selected:bg-xyne-orange-500/10 group-aria-selected:text-xyne-orange-500'>
          <Maximize2 size={16} />
        </span>
        <span className='flex-1 min-w-0 flex items-center flex-wrap gap-1'>
          <span className='whitespace-nowrap'>Expand to full-page search:</span>
          {chips}
          {queryText && <span className='font-semibold'>{queryText}</span>}
        </span>
        <button
          type='button'
          aria-label='Dismiss'
          // The row is a cmdk item: keep the press from also selecting (expanding) it.
          onPointerDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation();
            onDismiss();
          }}
          className='shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted'
          data-track-category='SEARCH'
          data-track-name='RETURN_BANNER_DISMISS'
        >
          <X size={14} />
        </button>
      </Command.Item>
    </div>
  );
}
