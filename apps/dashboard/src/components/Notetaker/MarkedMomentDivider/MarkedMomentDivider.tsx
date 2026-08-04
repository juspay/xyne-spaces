/**
 * Inline separator marking a transcript line the user flagged.
 *
 * Shared by the live transcript (LiveTranscriptList) and the finished transcript
 * (TranscriptSidePanel). Those two resolve *which* line to draw it above by very
 * different rules — live anchors on a transcript entry id, finished on an offset in
 * seconds — but the divider itself must read identically on both, or the same
 * recording ends up describing its moments two different ways.
 */

import type { ReactElement } from 'react';
import { Flag } from '@xyne/icons';

export const MarkedMomentDivider = (): ReactElement => (
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

export default MarkedMomentDivider;
