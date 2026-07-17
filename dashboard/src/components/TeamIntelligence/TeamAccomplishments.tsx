import { ChevronLeft, ChevronRight, RocketIcon } from 'lucide-react';
import { ReactElement, useEffect, useState } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import HighlightCard from './HighlightCard';
import { TeamHighlight } from '@/services/TeamIntelligence/teamIntelligenceService';
import { useTeamHighlights } from '@/hooks/useTeamIntelligence';
import { TeamIntelligenceOutletContext } from '@/routes/TeamIntelligenceScreen/TeamIntelligenceScreen';
import { Loader2 } from 'lucide-react';
import Button from '../ui/Button';

const TeamAccomplishments = (): ReactElement => {
  const { dateRange } = useOutletContext<TeamIntelligenceOutletContext>();
  const { teamId } = useParams<{ teamId: string }>();
  const [currentPage, setCurrentPage] = useState(1);
  const limit = 4;

  useEffect(() => {
    setCurrentPage(1);
  }, [dateRange.from, dateRange.to, teamId]);

  const {
    data: teamHighlights,
    isLoading: isLoadingHighlights,
    error,
  } = useTeamHighlights(teamId!, {
    from: dateRange.from,
    to: dateRange.to,
    page: currentPage,
    limit,
  });

  const highlights: TeamHighlight[] = teamHighlights?.bullets ?? [];
  const totalPages = teamHighlights?.totalPages ?? 0;
  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < totalPages;

  return (
    <section className='space-y-4'>
      <div className='flex items-center gap-3'>
        <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-green-600/10'>
          <RocketIcon className='h-4 w-4 text-green-600' />
        </div>
        <h3 className='text-lg font-semibold text-foreground'>What They Accomplished</h3>
      </div>

      {isLoadingHighlights ? (
        <div className='w-full rounded-xl border border-border/50 bg-card p-5 flex items-center justify-center gap-2'>
          <Loader2 size={16} className='animate-spin text-muted-foreground' />
          <p className='text-sm text-muted-foreground'>Loading highlights...</p>
        </div>
      ) : error ? (
        <div className='w-full rounded-xl border border-border/50 bg-card p-5'>
          <p className='text-sm text-muted-foreground'>
            Oops! Something went wrong while fetching the highlights. Please try again later.
          </p>
        </div>
      ) : (
        <>
          {highlights.length > 0 ? (
            <>
              <div className='grid gap-4 md:grid-cols-2'>
                {highlights.map(highlight => {
                  const type = highlight.bulletCat ?? 'default';

                  return (
                    <HighlightCard key={highlight.bulletId} highlight={highlight} type={type} />
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
        </>
      )}
    </section>
  );
};

export default TeamAccomplishments;
