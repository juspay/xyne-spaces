import { ReactElement, useState } from 'react';
import { ChevronLeft, ChevronRight, MessageSquareIcon } from 'lucide-react';
import { useOrgTicketRecaps } from '@/hooks/useTeamIntelligence';
import Button from '../ui/Button';
import { cn } from '@/utils/classNames';
import { useOutletContext } from 'react-router-dom';
import { TeamIntelligenceOutletContext } from '@/routes/TeamIntelligenceScreen/TeamIntelligenceScreen';

export const OrgTicketRecaps = (): ReactElement => {
  const { dateRange } = useOutletContext<TeamIntelligenceOutletContext>();
  const [currentPage, setCurrentPage] = useState(1);
  const limit = 4;

  const { data, isLoading, error } = useOrgTicketRecaps({
    from: dateRange.from,
    to: dateRange.to,
    page: currentPage,
    limit,
  });

  if (isLoading)
    return (
      <div className='space-y-4'>
        <div className='flex items-center gap-3'>
          <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-orange-600/10'>
            <MessageSquareIcon className='h-4 w-4 text-orange-600' />
          </div>
          <h3 className='text-lg font-semibold text-foreground'>Conversations Worth Noting</h3>
        </div>
        <div className='w-full rounded-xl border border-border/50 bg-card p-5'>
          <p className='text-sm text-muted-foreground'>Loading recaps...</p>
        </div>
      </div>
    );
  if (error)
    return (
      <div className='space-y-4'>
        <div className='flex items-center gap-3'>
          <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-orange-600/10'>
            <MessageSquareIcon className='h-4 w-4 text-orange-600' />
          </div>
          <h3 className='text-lg font-semibold text-foreground'>Conversations Worth Noting</h3>
        </div>
        <div className='w-full rounded-xl border border-border/50 bg-card p-5'>
          <p className='text-sm text-muted-foreground'>
            Oops! Something went wrong while fetching the recaps. Please try again later.
          </p>
        </div>
      </div>
    );

  const totalPages = data?.totalPages ?? 0;
  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < totalPages;

  if (!data || data.recaps.length === 0) {
    return (
      <div className='space-y-4'>
        <div className='flex items-center gap-3'>
          <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-orange-600/10'>
            <MessageSquareIcon className='h-4 w-4 text-orange-600' />
          </div>
          <h3 className='text-lg font-semibold text-foreground'>Conversations Worth Noting</h3>
        </div>
        <div className='w-full rounded-xl border border-border/50 bg-card p-5'>
          <p className='text-sm text-muted-foreground'>
            We couldn&rsquo;t find any notable conversations in the selected date range.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className='space-y-4'>
      <div className='flex items-center gap-3'>
        <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-orange-600/10'>
          <MessageSquareIcon className='h-4 w-4 text-orange-600' />
        </div>
        <h3 className='text-lg font-semibold text-foreground'>Conversations Worth Noting</h3>
      </div>

      {/* Recaps list */}
      <div className='space-y-4'>
        {data?.recaps.map(recap => (
          <article key={recap.id} className='rounded-xl border border-border/50 bg-card p-5'>
            <div className='flex items-start gap-4'>
              <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg')}>
                <MessageSquareIcon className={cn('h-4 w-4')} />
              </div>
              <div className='flex-1 space-y-1'>
                <div className='flex items-center gap-2'>
                  <span className='font-mono text-sm text-foreground font-semibold'>
                    {recap.channelName}
                  </span>
                  <span className='text-muted-foreground'>·</span>
                  <span className='text-xs text-muted-foreground'>{recap.recapDate}</span>
                </div>
                <p className='text-xs leading-relaxed text-muted-foreground'>{recap.summary}</p>
              </div>
            </div>
          </article>
        ))}
      </div>

      {/* Pagination controls */}
      <div className='flex items-center justify-between'>
        <Button
          variant={'outline'}
          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
          disabled={!canGoPrevious}
          className='flex items-center gap-2 px-4 py-2 border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50'
        >
          <ChevronLeft size={16} />
        </Button>

        <div className='flex items-center gap-2'>
          <span className='text-xs text-muted-foreground'>
            Page <span className='font-semibold'>{currentPage}</span> of{' '}
            <span className='font-semibold'>{totalPages}</span>
          </span>
        </div>

        <Button
          variant={'outline'}
          onClick={() => setCurrentPage(p => p + 1)}
          disabled={!canGoNext}
          className='flex items-center gap-2 px-4 py-2 border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50'
        >
          <ChevronRight size={16} />
        </Button>
      </div>
    </div>
  );
};

export default OrgTicketRecaps;
