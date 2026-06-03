import {
  GitCommitIcon,
  GitPullRequestIcon,
  SparklesIcon,
  TicketCheckIcon,
  TrendingUp,
} from 'lucide-react';
import { ReactElement } from 'react';
import { StatCard } from './StatCard';
import { useTeamMetrics, useTeamTicketRecaps } from '@/hooks/useTeamIntelligence';
import { TeamIntelligenceOutletContext } from '@/routes/TeamIntelligenceScreen/TeamIntelligenceScreen';
import { useOutletContext, useParams } from 'react-router-dom';

const TeamQuickInsights = (): ReactElement => {
  const { dateRange } = useOutletContext<TeamIntelligenceOutletContext>();
  const { teamId } = useParams<{ teamId: string }>();

  const { data: teamMetrics } = useTeamMetrics(teamId!, {
    from: dateRange.from,
    to: dateRange.to,
  });

  const { data: ticketRecapsData } = useTeamTicketRecaps(teamId!, {
    from: dateRange.from,
    to: dateRange.to,
    page: 1,
    limit: 4,
  });

  const totalPrCount = teamMetrics?.totalPrCount || 0;
  const totalCommitCount = teamMetrics?.totalCommitCount || 0;
  const totalAiTokens = teamMetrics?.aiUsages?.total_tokens || 0;
  const totalTickets = ticketRecapsData?.ticketMetrics?.totalCount || 0;
  const solvedTickets = ticketRecapsData?.ticketMetrics?.solvedCount || 0;

  return (
    <section className='space-y-4'>
      <div className='flex items-center gap-3'>
        <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-action-accent/10'>
          <TrendingUp className='h-4 w-4 text-action-accent' />
        </div>
        <h3 className='text-lg font-semibold text-foreground'>Team Metrics</h3>
      </div>

      <div className='grid gap-3 grid-cols-2'>
        <StatCard
          title='Development Velocity'
          value={totalPrCount}
          icon={GitPullRequestIcon}
          description='PRs Merged'
        />
        <StatCard
          title='Code Contributions'
          value={totalCommitCount}
          icon={GitCommitIcon}
          description='Commits Made'
        />
        <StatCard
          title='AI Adoption'
          value={totalAiTokens}
          icon={SparklesIcon}
          description='Total AI Tokens Used'
        />
        <StatCard
          title='Tickets Delivered'
          value={solvedTickets}
          icon={TicketCheckIcon}
          description={`Out of ${totalTickets} Tickets`}
        />
      </div>
    </section>
  );
};

export default TeamQuickInsights;
