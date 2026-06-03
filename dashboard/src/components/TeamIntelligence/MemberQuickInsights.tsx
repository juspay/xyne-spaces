import {
  BadgeDollarSign,
  GitCommitIcon,
  GitPullRequestIcon,
  SparklesIcon,
  TrendingUp,
} from 'lucide-react';
import { ReactElement } from 'react';
import { StatCard } from './StatCard';
import { UserProductivity } from '@/services/TeamIntelligence/teamIntelligenceService';

const MemberQuickInsights = ({ member }: { member: UserProductivity }): ReactElement => {
  const totalCommitCount = member.productivityMetrics?.totalCommitCount || 0;
  const mergedPrCount = member.productivityMetrics?.mergedPullRequestCount || 0;
  const totalAiTokens = member.aiUsages.totalTokens || 0;
  const aiCost = member.aiUsages.cost ?? { amount: 0, currency: 'USD' };

  return (
    <section className='space-y-4'>
      <div className='flex items-center gap-3'>
        <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-action-accent/10'>
          <TrendingUp className='h-4 w-4 text-action-accent' />
        </div>
        <h3 className='text-lg font-semibold text-foreground'>User Metrics</h3>
      </div>

      <div className='grid gap-3 grid-cols-2'>
        <StatCard
          title='Development Velocity'
          value={mergedPrCount}
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
          title='AI Cost'
          value={aiCost.amount}
          icon={BadgeDollarSign}
          description={`${aiCost.currency}`}
        />
      </div>
    </section>
  );
};

export default MemberQuickInsights;
