import { ReactElement, useState } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/utils/classNames';
import { useClawDigitalTwinMetrics } from '@/hooks/useClawDigitalTwin';
import { DigitalTwinKpis } from '@/components/ClawAgents/digitalTwin/metrics/DigitalTwinKpis';
import { DigitalTwinMetricsCharts } from '@/components/ClawAgents/digitalTwin/metrics/DigitalTwinMetricsCharts';

const DAY_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
  { label: 'All', value: null },
];

// Rendered inside ClawDigitalTwinScreen's right content — the shell already
// provides the "Digital Twin" title, actions, and left section nav, so this is
// just the metrics section body (sub-heading + range toggle + KPIs + charts).
const ClawDigitalTwinMetricsScreen = (): ReactElement => {
  const [days, setDays] = useState<number | null>(30);
  const { data, isLoading, error } = useClawDigitalTwinMetrics(days);

  return (
    <div className='flex flex-col gap-5'>
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div>
          <h2 className='text-base font-semibold text-foreground'>Approval metrics</h2>
          <p className='mt-1 text-sm text-muted-foreground'>
            How your Twin&apos;s candidates are reviewed — approval, edits, and where memories come
            from.
          </p>
        </div>

        <div className='flex items-center gap-1 rounded-full bg-muted p-1'>
          {DAY_OPTIONS.map(option => (
            <button
              key={option.label}
              type='button'
              onClick={() => setDays(option.value)}
              data-track-category='Claw Agents'
              data-track-name='Digital Twin metrics range'
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
        <div className='rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive'>
          Failed to load metrics: {error.message}
        </div>
      )}

      {isLoading || !data ? (
        <div className='flex flex-col gap-5'>
          <Skeleton className='h-28 w-full' />
          <Skeleton className='h-72 w-full' />
          <Skeleton className='h-72 w-full' />
        </div>
      ) : (
        <>
          <DigitalTwinKpis data={data} />
          <DigitalTwinMetricsCharts data={data} />
        </>
      )}
    </div>
  );
};

export default ClawDigitalTwinMetricsScreen;
