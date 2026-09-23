import type { ReactElement } from 'react';
import XyneAIStar from '../../../components/icons/xyne-ai/XyneAIStar';

/**
 * Stands in for the "Generate summary" panel when the viewer is not the person
 * who captured the recording. The backend only lets a recording's creator start
 * a summary run (`regenerateRecordingSummary` → 403 for everyone else), so a
 * viewer the recording was merely shared with gets the reason instead of a
 * button that would fail.
 *
 * Kept visually in the panel's family — same card chrome and star icon — so the
 * swap between "offer" and "explanation" reads as one box changing copy, not a
 * layout jump.
 */
export const NonOwnerSummaryNotice = (): ReactElement => (
  <div
    className='mt-4 w-full overflow-hidden rounded-xl border border-border/70 bg-card'
    data-testid='non-owner-summary-notice'
  >
    <div className='flex min-w-0 gap-3 px-5 py-4'>
      <span className='mt-0.5 shrink-0' aria-hidden='true'>
        <XyneAIStar size={12} />
      </span>
      <div className='min-w-0'>
        <p className='text-sm font-medium text-foreground'>
          This recording hasn&rsquo;t been summarized yet
        </p>
        <p className='mt-1 text-sm text-muted-foreground'>
          Only the person who captured this recording can generate its summary.
        </p>
      </div>
    </div>
  </div>
);

export default NonOwnerSummaryNotice;
