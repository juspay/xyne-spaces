import { ReactElement, useEffect, useState } from 'react';
import { useOrgHighlights } from '@/hooks/useTeamIntelligence';
import { useOutletContext } from 'react-router-dom';
import { TeamIntelligenceOutletContext } from '@/routes/TeamIntelligenceScreen/TeamIntelligenceScreen';
import { getHighlightTypeConfig } from './HighlightCard';
import { formatReportDate } from '@/utils/teamIntelligenceUtils';
import { ChevronLeft, ChevronRight, LoaderCircleIcon, RocketIcon } from 'lucide-react';
import { cn } from '@/utils/classNames';
import Button from '../ui/Button';

const OrgHighlights = (): ReactElement => {
  const { dateRange } = useOutletContext<TeamIntelligenceOutletContext>();
  const [currentPage, setCurrentPage] = useState(1);
  const limit = 4;

  useEffect(() => {
    setCurrentPage(1);
  }, [dateRange.from, dateRange.to]);

  const {
    data: orgHighlights,
    isLoading,
    error,
  } = useOrgHighlights({
    params: {
      from: dateRange.from,
      to: dateRange.to,
      page: currentPage,
      limit,
    },
  });

  const highlights = orgHighlights?.bullets || [];
  const totalPages = orgHighlights?.totalPages ?? 0;
  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < totalPages;

  if (isLoading) {
    return (
      <section className='space-y-4'>
        <div className='flex items-center gap-3'>
          <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10'>
            <RocketIcon className='h-4 w-4 text-green-500' />
          </div>
          <h3 className='text-lg font-semibold text-foreground'>Highlights</h3>
        </div>

        <div className='w-full rounded-xl border border-border/50 bg-card p-5 flex items-center gap-2'>
          <LoaderCircleIcon className='h-5 w-5 animate-spin text-muted-foreground' />
          <p className='text-sm text-muted-foreground'>Loading Highlights</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className='space-y-4'>
        <div className='flex items-center gap-3'>
          <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10'>
            <RocketIcon className='h-4 w-4 text-green-500' />
          </div>
          <h3 className='text-lg font-semibold text-foreground'>Highlights</h3>
        </div>
        <div className='w-full rounded-xl border border-border/50 bg-card p-5'>
          <p className='text-sm text-muted-foreground'>
            Oops! Something went wrong while fetching the highlights. Please try again later.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className='space-y-4'>
      <div className='flex items-center gap-3'>
        <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10'>
          <RocketIcon className='h-4 w-4 text-green-500' />
        </div>
        <h3 className='text-lg font-semibold text-foreground'>Highlights</h3>
      </div>

      {highlights.length > 0 ? (
        <>
          <div className='grid gap-4 md:grid-cols-2'>
            {highlights.map(highlight => {
              const type = highlight.bulletCat;
              const config = getHighlightTypeConfig(type);
              const Icon = config.icon;

              return (
                <article
                  key={highlight.bulletId}
                  className='group rounded-xl border border-border/50 bg-card p-5 transition-all hover:border-border hover:shadow-lg h-full'
                >
                  <div className='flex flex-col gap-3 h-full'>
                    <div className='flex items-center justify-between'>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
                          config.color,
                        )}
                      >
                        <Icon className='h-3 w-3' />
                        {config.label}
                      </span>
                      <span className='text-xs text-muted-foreground'>
                        {formatReportDate(highlight.reportDate)}
                      </span>
                    </div>
                    <h4 className='text-base font-medium text-foreground'>
                      {highlight.bulletTitle}
                    </h4>
                    <p className='text-sm leading-relaxed text-muted-foreground'>
                      {highlight.bulletText}
                    </p>
                    <div className='flex items-center justify-between border-t border-border/30 pt-3 mt-auto'>
                      <span className='text-xs text-muted-foreground'>{highlight.teamName}</span>
                      {/* <span className='flex items-center gap-1 text-xs font-medium text-action-accent'>
                  <TrendingUp className='h-3 w-3' />
                  {highlight.impact}
                </span> */}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Pagination controls */}
          {totalPages > 1 && (
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
          )}
        </>
      ) : (
        <div className='w-full rounded-xl border border-border/50 bg-card p-5'>
          <p className='text-sm text-muted-foreground'>
            No highlights for the selected date range.
          </p>
        </div>
      )}
    </section>
  );
};

export default OrgHighlights;
