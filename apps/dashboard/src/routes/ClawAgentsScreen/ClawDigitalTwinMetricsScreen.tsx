import { ReactElement, useState } from 'react';
import { RefreshCw } from '@/components/ClawAgents/digitalTwin/icons';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { useClawDigitalTwinMetrics } from '@/hooks/useClawDigitalTwin';
import { DigitalTwinKpis } from '@/components/ClawAgents/digitalTwin/metrics/DigitalTwinKpis';
import { DigitalTwinMetricsCharts } from '@/components/ClawAgents/digitalTwin/metrics/DigitalTwinMetricsCharts';

const DAY_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: '7 days', value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: 'All time', value: null },
];

const ClawDigitalTwinMetricsScreen = (): ReactElement => {
  const [days, setDays] = useState<number | null>(30);
  const metricsQuery = useClawDigitalTwinMetrics(days);

  return (
    <div className='flex flex-col gap-8'>
      <div className='grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end'>
        <div>
          <p className='dt-accent text-sm font-bold'>Inspect · Approval insights</p>
          <h2 className='dt-display mt-1 text-2xl font-semibold text-[var(--dt-ink)]'>
            What you keep, change, and reject
          </h2>
          <p className='dt-muted mt-2 max-w-[70ch] text-base'>
            Use these patterns to judge curator quality. Exact tables remain available for every
            visual comparison.
          </p>
        </div>
        <div
          className='flex flex-wrap items-center rounded-lg border dt-rule p-1'
          aria-label='Metrics range'
        >
          {DAY_OPTIONS.map(option => (
            <button
              key={option.label}
              type='button'
              onClick={() => setDays(option.value)}
              aria-pressed={days === option.value}
              className={
                days === option.value
                  ? 'dt-control dt-transition rounded-md bg-[var(--dt-ink)] px-3 text-sm font-semibold text-[var(--dt-paper)]'
                  : 'dt-control dt-transition rounded-md px-3 text-sm font-semibold text-[var(--dt-muted)] hover:text-[var(--dt-ink)]'
              }
              data-track-category='Claw Agents'
              data-track-name='Digital Twin metrics range'
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {metricsQuery.isError && (
        <div
          role='alert'
          className='border border-[var(--dt-danger)] bg-[var(--dt-danger-soft)] p-4'
        >
          <p className='font-semibold text-[var(--dt-danger)]'>Approval insights did not load.</p>
          <p className='dt-muted mt-1 text-sm'>{metricsQuery.error.message}</p>
          <Button
            variant='outline'
            className='dt-control mt-3'
            onClick={() => void metricsQuery.refetch()}
          >
            <RefreshCw className='size-4' />
            Try again
          </Button>
        </div>
      )}

      {metricsQuery.isLoading || !metricsQuery.data ? (
        <div className='flex flex-col gap-7'>
          <Skeleton className='h-56 rounded-none' />
          <Skeleton className='h-80 rounded-none' />
          <Skeleton className='h-72 rounded-none' />
        </div>
      ) : (
        <>
          <DigitalTwinKpis data={metricsQuery.data} />
          <DigitalTwinMetricsCharts data={metricsQuery.data} />
        </>
      )}
    </div>
  );
};

export default ClawDigitalTwinMetricsScreen;
