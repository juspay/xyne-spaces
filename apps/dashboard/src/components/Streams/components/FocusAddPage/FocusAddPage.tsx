import { ReactElement, forwardRef } from 'react';
import AddColumnPalette from '../AddColumnPalette/AddColumnPalette';
import { FOCUS_PEEK } from '../Streams/Streams.types';
import { DEV_DEFAULTS } from '../StreamsDev/StreamsDev';
import type { ColumnSource } from '../Streams/Streams.types';

export interface FocusAddPageProps {
  present: ReadonlySet<string>;
  onPick: (source: ColumnSource) => void;
  onDismiss: () => void;
}

/**
 * The last page of the focus carousel: the picker itself.
 *
 * Earlier versions put an invitation here — a "+" that grew as you scrolled in
 * and then handed over to the palette on arrival. Two states, and the handover
 * was the problem: however it was animated, arriving replaced the thing you had
 * just scrolled to with a different thing. The fix is not a better transition,
 * it is not having a transition to make. The palette is simply what this page
 * *is*, so there is nothing to swap and nothing to time.
 *
 * It stays mounted while focus mode is on, which costs one channel query — the
 * same one the palette always held, now held for as long as the mode rather than
 * for as long as it is open. The autofocus is the part that does need care: a
 * search field that grabs the keyboard because it exists somewhere off screen
 * would break typing in every other column, so it does not autofocus at all.
 * `StreamsScreen`'s scroll loop focuses it on arrival and blurs it on the way
 * out, which is the only moment either is the right thing to do.
 */
const FocusAddPage = forwardRef<HTMLDivElement, FocusAddPageProps>(
  ({ present, onPick, onDismiss }, ref): ReactElement => {
    const dev = DEV_DEFAULTS;
    return (
      <div
        ref={ref}
        // Same page width as a focused column, peek included, or the carousel's
        // last page would be a different size from every page before it.
        style={{ width: `calc(100% - ${dev.focusPeek ? FOCUS_PEEK : 0}px)` }}
        className='flex h-full shrink-0 snap-center flex-col'
        data-testid='streams-add-page'
      >
        <AddColumnPalette
          fill
          autoFocus={false}
          present={present}
          onPick={onPick}
          onDismiss={onDismiss}
        />
      </div>
    );
  },
);

FocusAddPage.displayName = 'FocusAddPage';

export default FocusAddPage;
