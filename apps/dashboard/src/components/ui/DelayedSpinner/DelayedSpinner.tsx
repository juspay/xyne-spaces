import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../../utils/classNames';

interface DelayedSpinnerProps {
  /**
   * How long to stay blank before revealing the spinner, in ms.
   * Keeps fast loads (Zero cache hits, sub-perceptible fetches) flash-free —
   * the user never sees a spinner that would only blink for a few frames.
   */
  delayMs?: number;
  /** Spinner icon size in px. */
  size?: number;
  /** Overrides the default fill-and-center container classes. */
  className?: string;
  /** Accessible label announced to assistive tech while loading. */
  label?: string;
}

/**
 * A loading placeholder that is intentionally BLANK for `delayMs` (default 500ms)
 * and only then reveals a centered spinner.
 *
 * Pair it with a Zero query's result details so the "no data" empty state is
 * never shown while a query is still in flight:
 *
 *   const [rows, details] = useCachedQuery(queries.something());
 *   if (details.type !== 'complete' && rows.length === 0) return <DelayedSpinner />;
 *   if (rows.length === 0) return <EmptyState />;   // now this means genuinely empty
 *
 * The container reserves layout space immediately (no jump when the spinner
 * appears), and the spinner auto-clears as soon as the caller swaps in data.
 */
export const DelayedSpinner = ({
  delayMs = 500,
  size = 20,
  className,
  label = 'Loading',
}: DelayedSpinnerProps): React.ReactElement => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  return (
    <div
      className={cn('flex flex-1 items-center justify-center py-8', className)}
      role='status'
      aria-live='polite'
      aria-busy={!show}
    >
      {show && (
        <>
          <Loader2 size={size} className='animate-spin text-muted-foreground' />
          <span className='sr-only'>{label}</span>
        </>
      )}
    </div>
  );
};

export default DelayedSpinner;
