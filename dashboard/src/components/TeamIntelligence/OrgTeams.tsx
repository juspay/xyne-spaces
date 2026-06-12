import { useTeamPulse } from '@/hooks/useTeamIntelligence';
import { TeamIntelligenceOutletContext } from '@/routes/TeamIntelligenceScreen/TeamIntelligenceScreen';
import { cn } from '@/utils/classNames';
import { getTeamColor, removeFormattedPrefix } from '@/utils/teamIntelligenceUtils';
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  Code2Icon,
  LoaderCircleIcon,
  UsersIcon,
} from 'lucide-react';
import { ReactElement } from 'react';
import { Link, useOutletContext } from 'react-router-dom';

const OrgTeams = (): ReactElement => {
  const { dateRange } = useOutletContext<TeamIntelligenceOutletContext>();

  const { data: teamPulseData, isLoading } = useTeamPulse({
    params: {
      from: dateRange.from,
      to: dateRange.to,
    },
  });

  const teams = teamPulseData?.teams || [];

  return (
    <section className='space-y-4'>
      <div className='flex items-center gap-3'>
        <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10'>
          <UsersIcon className='h-4 w-4 text-indigo-500' />
        </div>
        <h3 className='text-lg font-semibold text-foreground'>Team Pulse</h3>
      </div>

      {isLoading ? (
        <div className='w-full rounded-xl border border-border/50 bg-card p-5 flex items-center gap-2'>
          <LoaderCircleIcon className='h-5 w-5 animate-spin text-muted-foreground' />
          <p className='text-sm text-muted-foreground'>Loading Team Pulse</p>
        </div>
      ) : (
        <div className='space-y-3'>
          {teams?.map(team => {
            const cleanSummary =
              removeFormattedPrefix(team.summaryText[0] || '') || 'No recent updates';
            const teamColorHex = getTeamColor(team.teamName).primary;

            return (
              <Link
                key={team.teamId}
                to={`/team-intelligence/team/${encodeURIComponent(team.teamId)}`}
                className='group block w-full rounded-xl border border-border/50 bg-card p-5 transition-all hover:border-primary/30 hover:shadow-lg'
                data-track-category='team-intelligence'
                data-track-name={`team-${team.teamId}`}
              >
                <div className='flex items-start justify-between gap-4'>
                  <div className='space-y-3 flex-1'>
                    <div className='flex items-center gap-3'>
                      <span
                        className={cn('inline-flex h-2.5 w-2.5 rounded-full')}
                        style={{
                          backgroundColor: teamColorHex,
                        }}
                      />
                      <h4 className='text-base font-medium text-foreground'>{team.teamName}</h4>
                      {/* <span className='text-xs text-muted-foreground'>led by {team.lead}</span> */}
                    </div>

                    <p className='text-sm leading-relaxed text-muted-foreground'>{cleanSummary}</p>

                    <div className='flex items-center gap-6 text-xs text-muted-foreground'>
                      {/* <span className='flex items-center gap-1.5'>
                      <UsersIcon className='h-3.5 w-3.5' />
                      {team.members.length} members
                    </span> */}
                      <span className='flex items-center gap-1.5'>
                        <Code2Icon className='h-3.5 w-3.5' />
                        {team.commitCount} commits
                      </span>
                      <span className='flex items-center gap-1.5'>
                        <CheckCircle2Icon className='h-3.5 w-3.5' />
                        {team.prCount} PRs merged
                      </span>
                    </div>
                  </div>
                  <ChevronRightIcon className='h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary' />
                </div>
              </Link>
            );
          })}
          {teams.length === 0 && (
            <div className='w-full rounded-xl border border-border/50 bg-card p-5'>
              <p className='text-sm text-muted-foreground'>
                No teams with recent activity for the selected date range.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default OrgTeams;
