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
// The leading box mirrors SearchResultItem's 16px type icon (every backend row type has one).
const SearchSectionSkeleton = ({ rows = 3 }: { rows?: number }): ReactElement => (
  <div aria-hidden='true' data-testid='cmdk-search-skeleton'>
    {SKELETON_ROW_WIDTHS.slice(0, rows).map((width, index) => (
      <div key={index} className='flex items-center gap-3 px-2 py-2'>
        <Skeleton className={`h-4 w-4 shrink-0 rounded-sm ${SKELETON_BAR_CLASS}`} />
        <div className='flex flex-1 min-w-0 flex-col gap-2'>
          <Skeleton className={`h-3 ${width.title} ${SKELETON_BAR_CLASS}`} />
          <Skeleton className={`h-2.5 ${width.subtitle} ${SKELETON_BAR_CLASS}`} />
        </div>
        <Skeleton className={`h-2.5 w-11 shrink-0 rounded-full ${SKELETON_BAR_CLASS}`} />
      </div>
    ))}
  </div>
);

export default SearchSectionSkeleton;
