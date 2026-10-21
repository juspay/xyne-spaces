import { Skeleton } from '../../../components/ui/Skeleton';

const TITLE_WIDTHS = ['w-1/3', 'w-1/2', 'w-2/5', 'w-1/4', 'w-3/5'];

/** Shimmer rows shaped like the V2 recents CallCard (icon · title/meta · duration + avatars). */
export function RecentCallsSkeletonV2({ count = 5 }: { count?: number }): React.JSX.Element {
  return (
    <div className='flex flex-col gap-3.5' aria-busy='true' aria-label='Loading calls'>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className='flex items-center gap-3 px-3 py-2.5'>
          <Skeleton className='size-9 rounded-lg shrink-0' />
          <div className='flex flex-1 flex-col gap-1 min-w-0'>
            <Skeleton className={`h-3.5 ${TITLE_WIDTHS[index % TITLE_WIDTHS.length]}`} />
            <Skeleton className='h-3 w-40' />
          </div>
          <Skeleton className='h-3 w-10 shrink-0' />
          <div className='flex items-center -space-x-1.5 shrink-0'>
            <Skeleton className='size-6 rounded-full' />
            <Skeleton className='size-6 rounded-full' />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Shimmer rows shaped like UpcomingCallRowV2 (time · title/meta · action buttons). */
export function UpcomingCallsSkeletonV2({ count = 2 }: { count?: number }): React.JSX.Element {
  return (
    <div
      className='border border-border rounded-xl divide-y divide-border'
      aria-busy='true'
      aria-label='Loading upcoming calls'
    >
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className='flex items-center gap-4 py-3 pl-5 pr-3.5'>
          <Skeleton className='h-3 w-16 shrink-0' />
          <div className='flex flex-1 flex-col gap-1.5 min-w-0'>
            <Skeleton className={`h-3.5 ${TITLE_WIDTHS[index % TITLE_WIDTHS.length]}`} />
            <Skeleton className='h-3 w-32' />
          </div>
          <div className='flex items-center gap-1 shrink-0'>
            <Skeleton className='size-8 rounded-lg' />
            <Skeleton className='h-8 w-14 rounded-lg' />
          </div>
        </div>
      ))}
    </div>
  );
}
