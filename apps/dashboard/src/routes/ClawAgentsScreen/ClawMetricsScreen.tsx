import { ReactElement, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('common');
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
              {selectedAgent
                ? t('clawMetricsScreen.agentHeading', { agent: selectedAgent })
                : t('clawMetricsScreen.workspaceMetricsHeading')}
            </h1>
            <p className='mt-1 text-sm text-muted-foreground'>
              {selectedAgent
                ? t('clawMetricsScreen.agentDescription', { agent: selectedAgent })
                : t('clawMetricsScreen.workspaceDescription')}
            </p>
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-3'>
          {isAdmin && (
            <div className='flex items-center gap-2 text-xs text-muted-foreground'>
              <Switch
                checked={allOrgs}
                onCheckedChange={setAllOrgs}
                aria-label={t('clawMetricsScreen.showAllOrgsAriaLabel')}
              />
              <span>{t('clawMetricsScreen.allOrganizationsLabel')}</span>
            </div>
          )}
          <label htmlFor='claw-metrics-agent' className='text-xs text-muted-foreground'>
            {t('clawMetricsScreen.viewLabel')}
          </label>
          <select
            id='claw-metrics-agent'
            value={selectedAgent ?? ''}
            onChange={event => setSelectedAgent(event.target.value || null)}
            data-track-category='Claw Agents'
            data-track-name='Select metrics scope'
            className='h-9 min-w-44 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring'
          >
            <option value=''>{t('clawMetricsScreen.allWorkspaceOption')}</option>
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
          {t('clawMetricsScreen.failedToLoadMetrics', { message: error.message })}
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
                title={t('clawMetricsScreen.llmLatencyTitle')}
                description={t('clawMetricsScreen.llmLatencyDescription')}
              >
                <ProviderLatencyTable rows={global.data.byProvider} />
              </MetricsCard>
              <MetricsCard
                title={t('clawMetricsScreen.agentsLeaderboardTitle')}
                description={t('clawMetricsScreen.agentsLeaderboardDescription')}
              >
                <AgentLeaderboard rows={global.data.topAgents} onAgentClick={setSelectedAgent} />
              </MetricsCard>
            </>
          )}

          {selectedAgent && agent.data && (
            <>
              {agent.data.sentiment.totalRuns > 0 && (
                <MetricsCard
                  title={t('clawMetricsScreen.userSentimentTitle')}
                  description={t('clawMetricsScreen.userSentimentDescription')}
                >
                  <SentimentPanel sentiment={agent.data.sentiment} />
                </MetricsCard>
              )}
              <ImprovementsCard agentSlug={selectedAgent} />
              {agent.data.toolLatency.length > 0 && (
                <MetricsCard
                  title={t('clawMetricsScreen.toolLatencyTitle')}
                  description={t('clawMetricsScreen.toolLatencyDescription')}
                >
                  <ToolLatencyTable rows={agent.data.toolLatency} />
                </MetricsCard>
              )}
            </>
          )}

          {data.slowSessions.length > 0 && (
            <MetricsCard
              title={t('clawMetricsScreen.slowestSessionsTitle')}
              description={t('clawMetricsScreen.slowestSessionsDescription')}
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
