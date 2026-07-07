import {
  ClockAlertIcon,
  GitCommitIcon,
  SparklesIcon,
  TicketCheckIcon,
  TrendingUp,
} from 'lucide-react';
import { ReactElement } from 'react';
import { StatCard } from './StatCard';
import { useOrgSummary, useOrgTicketRecaps } from '@/hooks/useTeamIntelligence';
import { useOutletContext } from 'react-router-dom';
import { TeamIntelligenceOutletContext } from '@/routes/TeamIntelligenceScreen/TeamIntelligenceScreen';

const OrgQuickInsights = (): ReactElement => {
  const { dateRange } = useOutletContext<TeamIntelligenceOutletContext>();
  const { data, isLoading: isOrgSummaryLoading } = useOrgSummary({
    params: {
      from: dateRange.from,
      to: dateRange.to,
    },
  });

  const { data: ticketRecapsData, isLoading: isTicketRecapsLoading } = useOrgTicketRecaps({
    from: dateRange.from,
    to: dateRange.to,
    page: 1,
    limit: 4,
  });

  const totalPrs = data?.prTotal?.length || 0;
  const totalAiTokens = data?.aiUsages?.total_tokens || 0;
  const solvedTickets = ticketRecapsData?.ticketMetrics?.solvedCount || 0;
  const totalTickets = ticketRecapsData?.ticketMetrics?.totalCount || 0;
  const overDueTickets = ticketRecapsData?.ticketMetrics?.overdueCount || 0;

  return (
    <section className='space-y-4'>
      <div className='flex items-center gap-3'>
        <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-action-accent/10'>
          <TrendingUp className='h-4 w-4 text-action-accent' />
        </div>
        <h3 className='text-lg font-semibold text-foreground'>Quick Metrics</h3>
      </div>

      <div className='grid gap-3 grid-cols-1 md:grid-cols-2'>
        <StatCard
          title='Development Velocity'
          value={totalPrs}
          icon={GitCommitIcon}
          description='Total PRs'
          isLoading={isOrgSummaryLoading}
        />
        <StatCard
          title='AI Adoption'
          value={totalAiTokens}
          icon={SparklesIcon}
          description='Total AI Tokens Used'
          isLoading={isOrgSummaryLoading}
        />
        <StatCard
          title='Tickets Delivered'
          value={solvedTickets}
          icon={TicketCheckIcon}
          description={`Out of ${totalTickets} Tickets`}
          isLoading={isTicketRecapsLoading}
        />
        <StatCard
          title='Overdue Tickets'
          value={overDueTickets}
          icon={ClockAlertIcon}
          description={`Out of ${totalTickets} Tickets`}
          isLoading={isTicketRecapsLoading}
        />
      </div>
    </section>
  );
};

export default OrgQuickInsights;
