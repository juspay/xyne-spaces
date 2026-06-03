import { RocketIcon } from 'lucide-react';
import { ReactElement } from 'react';
import HighlightCard from './HighlightCard';
import { TeamHighlight } from '@/services/TeamIntelligence/teamIntelligenceService';

const TeamAccomplishments = ({ data }: { data: TeamHighlight[] }): ReactElement => {
  return (
    <section className='space-y-4'>
      <div className='flex items-center gap-3'>
        <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-green-600/10'>
          <RocketIcon className='h-4 w-4 text-green-600' />
        </div>
        <h3 className='text-lg font-semibold text-foreground'>What They Accomplished</h3>
      </div>

      <div className='grid gap-4 md:grid-cols-2'>
        {data.map(highlight => {
          const type = highlight.bulletCat ?? 'default';

          return <HighlightCard key={highlight.bulletId} highlight={highlight} type={type} />;
        })}
      </div>
      {data.length === 0 && (
        <div className='w-full rounded-xl border border-border/50 bg-card p-5'>
          <p className='text-sm text-muted-foreground'>
            No highlights for the selected date range.
          </p>
        </div>
      )}
    </section>
  );
};

export default TeamAccomplishments;
