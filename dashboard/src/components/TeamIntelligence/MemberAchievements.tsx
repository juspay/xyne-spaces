import { AwardIcon } from 'lucide-react';
import { ReactElement } from 'react';
import { UserProductivity } from '@/services/TeamIntelligence/teamIntelligenceService';
import { getTeamColor } from '@/utils/teamIntelligenceUtils';

const MemberAchievements = ({ member }: { member: UserProductivity }): ReactElement => {
  return (
    <section className='space-y-4'>
      <div className='flex items-center gap-3'>
        <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-green-600/10'>
          <AwardIcon className='h-4 w-4 text-green-600' />
        </div>
        <h3 className='text-lg font-semibold text-foreground'>What They Accomplished</h3>
      </div>

      <div className='space-y-4'>
        {member.teamInsights.items.map((insight, index) => {
          const teamColor = getTeamColor(insight.teamName).primary;

          return (
            <article
              key={index}
              className='rounded-xl border border-border/50 bg-card p-5 transition-all hover:border-border'
            >
              <div className='space-y-3'>
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-3'>
                    <span
                      className='h-2.5 w-2.5 rounded-full'
                      style={{ backgroundColor: teamColor }}
                    ></span>
                    <h4 className='text-base font-medium text-foreground'>{insight.teamName}</h4>
                  </div>
                  <span className='text-xs text-muted-foreground'>{insight.reportDate}</span>
                </div>

                <p className='text-sm leading-relaxed text-muted-foreground'>{insight.insight}</p>
              </div>
            </article>
          );
        })}
        {member.teamInsights.items.length === 0 && (
          <div className='w-full rounded-xl border border-border/50 bg-card p-5'>
            <p className='text-sm text-muted-foreground'>
              No accomplishments available in the selected time period.
            </p>
          </div>
        )}
      </div>
    </section>
  );
};

export default MemberAchievements;
