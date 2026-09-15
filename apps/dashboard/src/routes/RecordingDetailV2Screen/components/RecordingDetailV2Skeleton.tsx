import type { ReactElement } from 'react';
import { Skeleton } from '../../../components/ui/Skeleton';

/** Paragraph shapes for the summary body — ragged widths, like real prose. */
const SUMMARY_LINES = ['w-full', 'w-[94%]', 'w-[88%]', 'w-[62%]'] as const;

export function RecordingDetailV2Skeleton(): ReactElement {
  return (
    <div
      data-testid='recording-detail-v2-page'
      role='status'
      aria-live='polite'
      aria-busy='true'
      aria-label='Loading recording'
      className='relative flex h-full w-full flex-col overflow-hidden bg-background shadow-md md:rounded-2xl'
    >
      <span className='sr-only'>Loading recording</span>
      <div aria-hidden='true' className='h-full w-full overflow-y-scroll'>
        <div className='mx-auto flex min-h-full w-full max-w-[860px] flex-col px-4 py-6'>
          <div className='-mx-4 -mt-6 flex flex-col bg-background px-4 pt-6'>
            <header className='mb-6'>
              <div className='mb-3 flex h-5 items-center gap-1.5'>
                <Skeleton className='h-3 w-24' />
                <Skeleton className='h-3 w-1' />
                <Skeleton className='h-3 w-44' />
              </div>

              <div className='mb-4'>
                <div className='flex h-9 items-center'>
                  <Skeleton className='h-7 w-[24rem] max-w-full !rounded-lg' />
                </div>
                {/* The date · duration line */}
                <div className='mt-2.5 flex h-5 items-center'>
                  <Skeleton className='h-3 w-52' />
                </div>
              </div>

              {/* Chips on the left, Ask AI on the right */}
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <div className='flex flex-wrap items-center gap-2'>
                  <Skeleton className='h-7 w-16 !rounded-lg' />
                  <Skeleton className='h-7 w-32 !rounded-lg' />
                  <Skeleton className='h-7 w-8 !rounded-lg' />
                </div>
                <Skeleton className='h-8 w-24 rounded-xl' />
              </div>
            </header>

            <div className='flex flex-col pt-2'>
              {/* Control bar: the real card, with the transport stood in inside it */}
              <div className='mb-6 rounded-2xl border border-border bg-card px-5 py-4'>
                <div className='flex min-h-11 items-center gap-4'>
                  <Skeleton className='size-8 shrink-0 !rounded-full' />
                  <Skeleton className='h-3 w-12 shrink-0' />
                  <Skeleton className='h-1.5 flex-1 !rounded-full' />
                  <Skeleton className='h-3 w-12 shrink-0' />
                  {/* The visualizer's own bordered well, with its bars at rest */}
                  <div className='inline-flex h-7 w-14 shrink-0 items-center justify-center gap-0.5 rounded-lg border border-border'>
                    {Array.from({ length: 4 }, (_, index) => (
                      <Skeleton key={index} className='size-1 !rounded-full' />
                    ))}
                  </div>
                </div>
              </div>

              {/* Tab strip: the segmented control is one filled pill, so it stands in
                  as one shape; the post/share action sits opposite it. */}
              <div className='mb-4 flex items-center justify-between border-b border-border/70 pb-2'>
                <Skeleton className='h-10 w-[19rem] max-w-full !rounded-full' />
                <Skeleton className='h-8 w-40 !rounded-lg' />
              </div>
            </div>
          </div>

          {/* Summary pane: heading and the transcript toggle, then the body */}
          <section className='mb-8 max-w-full'>
            <div className='flex items-center justify-between'>
              <Skeleton className='h-4 w-24' />
              <Skeleton className='size-8 !rounded-lg' />
            </div>

            <div className='mt-6 flex flex-col gap-3'>
              {SUMMARY_LINES.map(width => (
                <Skeleton key={width} className={`h-3 ${width}`} />
              ))}
            </div>

            <div className='mt-8 flex flex-col gap-3'>
              <Skeleton className='h-3.5 w-40' />
              {SUMMARY_LINES.slice(0, 3).map(width => (
                <Skeleton key={width} className={`h-3 ${width}`} />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
