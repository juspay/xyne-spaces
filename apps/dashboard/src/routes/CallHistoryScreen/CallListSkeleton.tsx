import { Skeleton } from '../../components/ui/Skeleton';

const TITLE_WIDTHS = ['w-1/3', 'w-1/2', 'w-2/5', 'w-1/4', 'w-3/5'];

/** Shimmer rows shaped like a CallCard pill (icon · title/meta · avatar stack). */
export function CallListSkeleton({ count = 5 }: { count?: number }): React.JSX.Element {
  return (
    <div className='flex flex-col gap-3' aria-busy='true' aria-label='Loading calls'>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className='flex items-center gap-3 p-1.5'>
          <Skeleton className='size-9 rounded-lg shrink-0' />
          <div className='flex flex-1 flex-col gap-1.5 min-w-0'>
            <Skeleton className={`h-3.5 ${TITLE_WIDTHS[index % TITLE_WIDTHS.length]}`} />
            <Skeleton className='h-3 w-24' />
          </div>
          <div className='flex items-center -space-x-1.5 shrink-0'>
            <Skeleton className='size-6 rounded-md' />
            <Skeleton className='size-6 rounded-md' />
          </div>
        </div>
      ))}
    </div>
  );
}

export default CallListSkeleton;
