import type { ReactElement } from 'react';

/** First load only; a range change keeps the previous render, dimmed. */
export const AnalyticsSkeleton = (): ReactElement => (
  <div className='flex flex-col gap-5' aria-hidden='true'>
    <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6'>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className='h-[92px] animate-pulse rounded-2xl bg-muted' />
      ))}
    </div>
    <div className='h-[120px] animate-pulse rounded-2xl bg-muted' />
    <div className='grid grid-cols-1 gap-5 lg:grid-cols-2'>
      <div className='h-[300px] animate-pulse rounded-2xl bg-muted' />
      <div className='h-[300px] animate-pulse rounded-2xl bg-muted' />
    </div>
  </div>
);
