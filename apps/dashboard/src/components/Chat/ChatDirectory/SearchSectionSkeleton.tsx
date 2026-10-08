import { ReactElement } from 'react';
import { Skeleton } from '../../ui/Skeleton';

// Varied per row so the skeleton reads as "content coming", not a striped pattern.
const SKELETON_ROW_WIDTHS = [
  { title: 'w-[44%]', subtitle: 'w-[74%]' },
  { title: 'w-[52%]', subtitle: 'w-[62%]' },
  { title: 'w-[34%]', subtitle: 'w-[66%]' },
  { title: 'w-[48%]', subtitle: 'w-[70%]' },
];

// Skeleton's own `bg-muted` is ~4% off the palette's white background and barely shows, so
// darken the bars here. `!` because Skeleton always adds `bg-muted` and Tailwind resolves two
// bg utilities by stylesheet order, not class order.
const SKELETON_BAR_CLASS = '!bg-muted-foreground/30';

// Loading placeholder for a backend result section in Cmd+K while a search is pending. Plain
// divs, not Command.Items, so arrow keys skip them and selection stays on local results.
// Each row has SearchResultItem's geometry — same padding and spacing, a 16px type icon, the
// 18px title line and 16px meta line, the timestamp bottom-right — so when results land, each
// one takes the place its placeholder held instead of the list shifting.
const SearchSectionSkeleton = ({ rows = 3 }: { rows?: number }): ReactElement => (
  <div aria-hidden='true' data-testid='cmdk-search-skeleton'>
    {SKELETON_ROW_WIDTHS.slice(0, rows).map((width, index) => (
      <div key={index} className='flex w-full items-stretch gap-3 p-3 mt-1.5'>
        <span className='flex shrink-0 items-center'>
          <Skeleton className={`h-4 w-4 rounded-sm ${SKELETON_BAR_CLASS}`} />
        </span>
        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
          <div className='flex h-[18px] items-center'>
            <Skeleton className={`h-3 ${width.title} ${SKELETON_BAR_CLASS}`} />
          </div>
          <div className='flex h-4 items-center'>
            <Skeleton className={`h-2.5 ${width.subtitle} ${SKELETON_BAR_CLASS}`} />
          </div>
        </div>
        <div className='flex shrink-0 flex-col items-end justify-between gap-0.5'>
          <span className='h-[18px] w-7' />
          <Skeleton className={`h-2.5 w-24 rounded-full ${SKELETON_BAR_CLASS}`} />
        </div>
      </div>
    ))}
  </div>
);

export default SearchSectionSkeleton;
