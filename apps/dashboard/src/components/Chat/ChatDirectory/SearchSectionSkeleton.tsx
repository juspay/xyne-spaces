import { ReactElement } from 'react';

// Varied per row so the skeleton reads as "content coming", not a striped pattern.
const SKELETON_ROW_WIDTHS = [
  { title: 'w-[44%]', subtitle: 'w-[74%]', body: 'w-[58%]' },
  { title: 'w-[52%]', subtitle: 'w-[62%]', body: 'w-[70%]' },
  { title: 'w-[34%]', subtitle: 'w-[66%]', body: 'w-[52%]' },
  { title: 'w-[48%]', subtitle: 'w-[70%]', body: 'w-[64%]' },
];

// Bar colour + gradient live in global.css. Not the shared `Skeleton`: its `bg-muted`
// is near-invisible on white and `animate-pulse` blinks the whole bar.
// The full-screen column is far wider than the palette, so the same percentages
// would read as full-width slabs. Narrower ones match how the cards actually fill.
const PAGE_ROW_WIDTHS = [
  { title: 'w-[26%]', subtitle: 'w-[42%]', body: 'w-[34%]' },
  { title: 'w-[32%]', subtitle: 'w-[36%]', body: 'w-[44%]' },
  { title: 'w-[20%]', subtitle: 'w-[40%]', body: 'w-[30%]' },
  { title: 'w-[29%]', subtitle: 'w-[44%]', body: 'w-[38%]' },
];

const SKELETON_BAR_CLASS = 'search-skeleton-bar';

/**
 * Which result row this stands in for. `message|ticket|file|desk` copy cmdK's
 * SearchResultItem rows; the `page-*` ones copy the full-screen page's bordered cards.
 */
export type SkeletonVariant =
  | 'message'
  | 'ticket'
  | 'file'
  | 'desk'
  | 'page-message'
  | 'page-ticket'
  | 'page-file'
  | 'page-desk';

const PAGE_VARIANTS = new Set<SkeletonVariant>([
  'page-message',
  'page-ticket',
  'page-file',
  'page-desk',
]);

const Bar = ({ className }: { className: string }): ReactElement => (
  <div className={`rounded-md ${className} ${SKELETON_BAR_CLASS}`} />
);
const Icon = (): ReactElement => (
  <div className={`h-4 w-4 shrink-0 rounded-sm ${SKELETON_BAR_CLASS}`} />
);

// Loading rows for a backend result section. Plain divs, not Command.Items, so arrow keys skip
// them. Each variant copies its row's box in SearchResultItem — message 70px, ticket/file 66px,
// desk 88px — so nothing shifts when the results replace it.
const SearchSectionSkeleton = ({
  rows = 3,
  variant = 'message',
}: {
  rows?: number;
  variant?: SkeletonVariant;
}): ReactElement => (
  <div
    aria-hidden='true'
    data-testid='cmdk-search-skeleton'
    // The page stacks its cards with space-y-2; cmdK rows carry their own mt-1.5.
    className={PAGE_VARIANTS.has(variant) ? 'space-y-2' : undefined}
  >
    {(PAGE_VARIANTS.has(variant) ? PAGE_ROW_WIDTHS : SKELETON_ROW_WIDTHS)
      .slice(0, rows)
      .map((width, index) => {
        // Full-screen ticket strip: id, title, status, assignee on one line.
        if (variant === 'page-ticket') {
          return (
            <div
              key={index}
              className='flex items-center gap-3 rounded-md border bg-card px-3 py-1.5 shadow-sm'
            >
              <Bar className='h-3.5 w-16 shrink-0' />
              <div className='flex h-5 min-w-0 flex-1 items-center'>
                <Bar className={`h-3.5 ${width.title}`} />
              </div>
              <Bar className='h-3.5 w-14 shrink-0' />
              <div className={`size-5 shrink-0 rounded-lg ${SKELETON_BAR_CLASS}`} />
            </div>
          );
        }
        // Full-screen mail card: subject + date, ticket id, sender, body snippet.
        if (variant === 'page-desk') {
          return (
            <div
              key={index}
              className='flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3'
            >
              <div className={`size-9 shrink-0 rounded-lg ${SKELETON_BAR_CLASS}`} />
              <div className='min-w-0 flex-1'>
                <div className='flex h-5 items-center justify-between gap-2'>
                  <Bar className={`h-3.5 ${width.title}`} />
                  <Bar className='h-3.5 w-24 shrink-0' />
                </div>
                <div className='flex h-4 items-center'>
                  <Bar className='h-3 w-16' />
                </div>
                <div className='flex h-4 items-center'>
                  <Bar className={`h-3 ${width.subtitle}`} />
                </div>
                <div className='mt-0.5 flex h-9 items-start'>
                  <Bar className={`h-3 ${width.body}`} />
                </div>
              </div>
            </div>
          );
        }
        // Full-screen file card: icon, name + date, then the metadata line. Both lines are 24px:
        // the card renders them through RenderMessageWithHTML, which sets its own line box.
        if (variant === 'page-file') {
          return (
            <div
              key={index}
              className='flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3'
            >
              <div className={`size-9 shrink-0 rounded-lg ${SKELETON_BAR_CLASS}`} />
              <div className='min-w-0 flex-1'>
                <div className='flex h-6 items-center justify-between gap-2'>
                  <Bar className={`h-3.5 ${width.title}`} />
                  <Bar className='h-3.5 w-24 shrink-0' />
                </div>
                <div className='flex h-6 items-center'>
                  <Bar className={`h-3 ${width.subtitle}`} />
                </div>
              </div>
            </div>
          );
        }
        // Full-screen message card: avatar, sender + timestamp, snippet.
        if (variant === 'page-message') {
          return (
            <div key={index} className='rounded-xl border border-border/60 bg-card py-1'>
              <div className='flex items-start gap-3 px-4 py-1.5'>
                {/* MessageBubble's avatar is a size-8 rounded-sm square, not a circle. */}
                <div className={`size-8 shrink-0 rounded-sm ${SKELETON_BAR_CLASS}`} />
                <div className='min-w-0 flex-1'>
                  <div className='flex h-5 items-center justify-between gap-2'>
                    <Bar className='h-3.5 w-28' />
                    <Bar className='h-3.5 w-32 shrink-0' />
                  </div>
                  <div className='flex h-5 items-center'>
                    <Bar className={`h-3.5 ${width.subtitle}`} />
                  </div>
                </div>
              </div>
            </div>
          );
        }
        // Icon centred beside both lines, timestamp on the meta line.
        if (variant === 'ticket' || variant === 'file') {
          return (
            <div key={index} className='mt-1.5 flex items-center gap-3 p-3'>
              <Icon />
              <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                <div className='flex h-5 items-center'>
                  <Bar className={`h-3.5 ${width.title}`} />
                </div>
                <div className='flex h-5 items-center justify-between gap-2'>
                  <Bar className={`h-3.5 ${width.subtitle}`} />
                  <Bar className='h-3.5 w-11 shrink-0' />
                </div>
              </div>
            </div>
          );
        }
        // Mail: subject + date, then sender, then the body snippet.
        if (variant === 'desk') {
          return (
            <div key={index} className='mt-1.5 flex flex-col gap-0.5 p-3'>
              <div className='flex h-5 items-center gap-1.5'>
                <Icon />
                <Bar className={`h-3.5 ${width.title}`} />
                <Bar className='ml-auto h-3.5 w-11 shrink-0' />
              </div>
              <div className='flex h-5 items-center pl-6'>
                <Bar className={`h-3.5 ${width.subtitle}`} />
              </div>
              <div className='flex h-5 items-center pl-6'>
                <Bar className={`h-3.5 ${width.body}`} />
              </div>
            </div>
          );
        }
        return (
          <div key={index} className='mt-1.5 flex flex-col gap-0.5 p-3'>
            <div className='flex h-5 items-center gap-1.5'>
              <Icon />
              <Bar className={`h-3.5 ${width.title}`} />
              <Bar className='ml-auto h-3.5 w-11 shrink-0' />
            </div>
            <div className='flex h-6 items-center pl-6'>
              <Bar className={`h-3.5 ${width.subtitle}`} />
            </div>
          </div>
        );
      })}
  </div>
);

export default SearchSectionSkeleton;
