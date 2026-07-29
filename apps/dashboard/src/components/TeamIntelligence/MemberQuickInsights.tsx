import {
  BadgeDollarSign,
  GitCommitIcon,
  GitPullRequestIcon,
  SparklesIcon,
  TrendingUp,
} from 'lucide-react';
import { ReactElement } from 'react';
import { StatCard } from './StatCard';
import { useOutletContext, useParams } from 'react-router-dom';
import { TeamIntelligenceOutletContext } from '@/routes/TeamIntelligenceScreen/TeamIntelligenceScreen';
import { useMemberInsights } from '@/hooks/useTeamIntelligence';

const MemberQuickInsights = (): ReactElement => {
  const { dateRange } = useOutletContext<TeamIntelligenceOutletContext>();
  const { memberEmail } = useParams<{ memberEmail: string }>();

  const { data: member, isLoading } = useMemberInsights(memberEmail!, {
    from: dateRange.from,
    to: dateRange.to,
  });

  const totalCommitCount = member?.productivityMetrics?.totalCommitCount || 0;
  const mergedPrCount = member?.productivityMetrics?.mergedPullRequestCount || 0;
  const totalAiTokens = member?.aiUsages?.totalTokens || 0;
  const aiCost = member?.aiUsages?.cost ?? { amount: 0, currency: 'USD' };

  return (
    <section className='space-y-4'>
      <div className='flex items-center gap-3'>
        <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-action-accent/10'>
          <TrendingUp className='h-4 w-4 text-action-accent' />
        </div>
        <h3 className='text-lg font-semibold text-foreground'>User Metrics</h3>
      </div>

      <div className='grid gap-3 grid-cols-1 sm:grid-cols-2'>
        <StatCard
          title='Development Velocity'
          value={mergedPrCount}
          icon={GitPullRequestIcon}
          description='PRs Merged'
          isLoading={isLoading}
        />
        <StatCard
          title='Code Contributions'
          value={totalCommitCount}
          icon={GitCommitIcon}
          description='Commits Made'
          isLoading={isLoading}
        />
        <StatCard
          title='AI Adoption'
          value={totalAiTokens}
          icon={SparklesIcon}
          description='Total AI Tokens Used'
          isLoading={isLoading}
        />
        <StatCard
          title='AI Cost'
          value={aiCost.amount}
          icon={BadgeDollarSign}
          description={`${aiCost.currency}`}
          isLoading={isLoading}
        />
      </div>
    </section>
  );
};

export default MemberQuickInsights;
