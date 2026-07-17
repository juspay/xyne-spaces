import DOMPurify from 'dompurify';
import { Team } from '@/services/TeamIntelligence/teamIntelligenceService';
import { cn } from '@/utils/classNames';
import { getTeamColor } from '@/utils/teamIntelligenceUtils';
import { ReactElement } from 'react';

const TeamHeader = ({ team }: { team: Team }): ReactElement => {
  const teamName = team?.name || 'Unknown Team';
  const teamColor = getTeamColor(teamName).primary;
  const description = team?.description || 'No description available.';

  return (
    <section className='space-y-6'>
      <div className='space-y-2'>
        <div className='flex items-center gap-3'>
          <span
            className={cn('inline-flex h-3 w-3 rounded-full')}
            style={{
              backgroundColor: teamColor,
            }}
          />
          <span
            className={cn('text-xs font-medium uppercase tracking-widest')}
            style={{
              color: teamColor,
            }}
          >
            Team Intelligence
          </span>
        </div>
        <h2 className='text-3xl font-light text-foreground md:text-4xl'>{teamName}</h2>
        <div
          className='text-sm text-muted-foreground [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1 [&_p]:leading-relaxed [&_strong]:text-foreground [&_em]:italic'
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(description) }}
        />
      </div>
    </section>
  );
};

export default TeamHeader;
