import { ReactElement, useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { Switch } from '@/components/ui/Switch';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  useClawAgentMetrics,
  useClawGlobalMetrics,
  useClawMetricsAgentSlugs,
} from '@/hooks/useClawMetrics';
import { useIsClawAdmin } from '@/hooks/useIsClawAdmin';
import type { AdminOrgScope, ClawMetricsDays } from '@/services/claw/clawMetricsTypes';
import { cn } from '@/utils/classNames';
import { ImprovementsCard } from '@/components/ClawAgents/metrics/ImprovementsCard';
import { MetricsCard } from '@/components/ClawAgents/metrics/MetricsCard';
import { MetricsCharts } from '@/components/ClawAgents/metrics/MetricsCharts';
import { MetricsOverview } from '@/components/ClawAgents/metrics/MetricsOverview';
import {
  AgentLeaderboard,
  BotCommitAnalyticsTable,
  ProviderLatencyTable,
  SlowSessionsTable,
  ToolLatencyTable,
} from '@/components/ClawAgents/metrics/MetricsTables';
import { SentimentPanel } from '@/components/ClawAgents/metrics/SentimentPanel';

const DAY_OPTIONS: Array<{ label: string; value: ClawMetricsDays }> = [
  { label: '1d', value: 1 },
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
];

const ClawMetricsScreen = (): ReactElement => {
  const [days, setDays] = useState<ClawMetricsDays>(7);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [allOrgs, setAllOrgs] = useState(false);
  const { data: isAdmin = false } = useIsClawAdmin();
  const orgScope: AdminOrgScope = isAdmin && allOrgs ? 'all' : 'org';
  const global = useClawGlobalMetrics(days, orgScope);
  const agent = useClawAgentMetrics(selectedAgent ?? undefined, days, orgScope);
  const { data: agentSlugs = [] } = useClawMetricsAgentSlugs(orgScope);
  const data = selectedAgent ? agent.data : global.data;
  const loading = selectedAgent ? agent.isLoading : global.isLoading;
  const error = selectedAgent ? agent.error : global.error;

  useEffect(() => {
    if (!isAdmin && allOrgs) setAllOrgs(false);
  }, [isAdmin, allOrgs]);

  return (
    <div className='mx-auto w-full max-w-7xl px-6 py-8'>
      <div className='mb-5 flex flex-wrap items-start justify-between gap-4'>
        <div className='flex items-start gap-3'>
          <div className='flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted'>
            <BarChart3 className='size-5 text-foreground' />
          </div>
          <div>
            <h1 className='text-xl font-semibold text-foreground'>
              {selectedAgent ? `Agent · ${selectedAgent}` : 'Workspace metrics'}
            </h1>
            <p className='mt-1 text-sm text-muted-foreground'>
              {selectedAgent
                ? `Latency, throughput, sentiment, and tool performance for ${selectedAgent}.`
                : 'Latency, throughput, errors, and provider performance across your accessible runs.'}
            </p>
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-3'>
          {isAdmin && (
            <div className='flex items-center gap-2 text-xs text-muted-foreground'>
              <Switch
                checked={allOrgs}
                onCheckedChange={setAllOrgs}
                aria-label='Show metrics across all organizations'
              />
              <span>All organizations</span>
            </div>
          )}
          <label htmlFor='claw-metrics-agent' className='text-xs text-muted-foreground'>
            View
          </label>
          <select
            id='claw-metrics-agent'
            value={selectedAgent ?? ''}
            onChange={event => setSelectedAgent(event.target.value || null)}
            data-track-category='Claw Agents'
            data-track-name='Select metrics scope'
            className='h-9 min-w-44 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring'
          >
            <option value=''>All workspace</option>
            {agentSlugs.map(slug => (
              <option key={slug} value={slug}>
                {slug}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className='mb-5 flex justify-end'>
        <div className='flex items-center gap-1 rounded-full bg-muted p-1'>
          {DAY_OPTIONS.map(option => (
            <button
              key={option.value}
              type='button'
              onClick={() => setDays(option.value)}
              data-track-category='Claw Agents'
              data-track-name='Change metrics date range'
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                days === option.value
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className='mb-5 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive'>
          Failed to load metrics: {error.message}
        </div>
      )}

      {loading || !data ? (
        <div className='flex flex-col gap-5'>
          <Skeleton className='h-28 w-full' />
          <Skeleton className='h-72 w-full' />
          <Skeleton className='h-72 w-full' />
        </div>
      ) : (
        <div className='flex flex-col gap-5'>
          <MetricsOverview data={data} />
          <MetricsCharts perDay={data.perDay} />

          {!selectedAgent && global.data && (
            <>
              <MetricsCard
                title='LLM latency by provider and model'
                description='Compare model pairs by median latency, slow tail, time to first token, throughput, and errors.'
              >
                <ProviderLatencyTable rows={global.data.byProvider} />
              </MetricsCard>
              <MetricsCard
                title='Agents leaderboard'
                description='Agents ranked by run count. Select a row to drill into its metrics.'
              >
                <AgentLeaderboard rows={global.data.topAgents} onAgentClick={setSelectedAgent} />
              </MetricsCard>
              <MetricsCard
                title='Bot commit analytics'
                description='Pull request outcomes by bot attribution type. Shows merge rates for bot-attributed vs human-attributed PRs.'
              >
                <BotCommitAnalyticsTable analytics={global.data.botCommitAnalytics} />
              </MetricsCard>
            </>
          )}

          {selectedAgent && agent.data && (
            <>
              {agent.data.sentiment.totalRuns > 0 && (
                <MetricsCard
                  title='User sentiment and feedback'
                  description='Explicit ratings and behavioral signals for the selected window.'
                >
                  <SentimentPanel sentiment={agent.data.sentiment} />
                </MetricsCard>
              )}
              <ImprovementsCard agentSlug={selectedAgent} />
              {agent.data.toolLatency.length > 0 && (
                <MetricsCard
                  title='Tool latency'
                  description='Tools ranked by cumulative time to identify the largest bottlenecks.'
                >
                  <ToolLatencyTable rows={agent.data.toolLatency} />
                </MetricsCard>
              )}
            </>
          )}

          {data.slowSessions.length > 0 && (
            <MetricsCard
              title='Slowest sessions'
              description='Slow runs ranked by total wall-clock time. Expand a row for its tool breakdown.'
            >
              <SlowSessionsTable rows={data.slowSessions} showAgent={!selectedAgent} />
            </MetricsCard>
          )}
        </div>
      )}
    </div>
  );
};

export default ClawMetricsScreen;
