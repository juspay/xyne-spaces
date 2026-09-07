import { ReactElement, useState } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { SegmentedToggle } from '@/components/ui/SegmentedToggle';
import { useClawDigitalTwinMetrics } from '@/hooks/useClawDigitalTwin';
import { DigitalTwinKpis } from '../components/metrics/DigitalTwinKpis';
import { DigitalTwinMetricsCharts } from '../components/metrics/DigitalTwinMetricsCharts';

const DAY_OPTIONS: Array<{ label: string; value: number | null }> = [
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
  { label: 'All', value: null },
];

const DigitalTwinMetricsTab = (): ReactElement => {
  const [days, setDays] = useState<number | null>(30);
  const { data, isLoading, error } = useClawDigitalTwinMetrics(days);
  const activeRangeLabel = DAY_OPTIONS.find(option => option.value === days)?.label ?? 'All';

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

        <SegmentedToggle
          options={DAY_OPTIONS.map(option => ({ value: option.label, label: option.label }))}
          value={activeRangeLabel}
          onChange={label =>
            setDays(DAY_OPTIONS.find(option => option.label === label)?.value ?? null)
          }
          tone='primary'
          trackCategory='Claw Agents'
          trackPrefix='Digital Twin metrics range'
        />
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

export default DigitalTwinMetricsTab;
