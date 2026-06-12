import { RocketIcon } from 'lucide-react';
import { ReactElement } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import HighlightCard from './HighlightCard';
import { TeamHighlight } from '@/services/TeamIntelligence/teamIntelligenceService';
import { useTeamHighlights } from '@/hooks/useTeamIntelligence';
import { TeamIntelligenceOutletContext } from '@/routes/TeamIntelligenceScreen/TeamIntelligenceScreen';
import { Loader2 } from 'lucide-react';

const TeamAccomplishments = (): ReactElement => {
  const { dateRange } = useOutletContext<TeamIntelligenceOutletContext>();
  const { teamId } = useParams<{ teamId: string }>();

  const { data: teamHighlights, isLoading: isLoadingHighlights } = useTeamHighlights(teamId!, {
    from: dateRange.from,
    to: dateRange.to,
  });

  const highlights: TeamHighlight[] = teamHighlights?.bullets ?? [];

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
      ) : (
        <>
          <div className='grid gap-4 md:grid-cols-2'>
            {highlights.map(highlight => {
              const type = highlight.bulletCat ?? 'default';

              return <HighlightCard key={highlight.bulletId} highlight={highlight} type={type} />;
            })}
          </div>
          {highlights.length === 0 && (
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
