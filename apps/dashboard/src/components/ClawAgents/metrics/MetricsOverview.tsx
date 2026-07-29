import { ReactElement } from 'react';
import { cn } from '@/utils/classNames';
import type { AgentMetrics, GlobalMetrics } from '@/services/claw/clawMetricsTypes';
import {
  formatMs,
  formatPct,
  formatSignedMs,
  formatSignedPct,
  type MetricDelta,
} from './formatters';

const toneClass = (tone: MetricDelta['tone']): string => {
  if (tone === 'good') return 'text-emerald-600 dark:text-emerald-400';
  if (tone === 'bad') return 'text-destructive';
  return 'text-muted-foreground';
};

const Hero = ({
  label,
  value,
  help,
  delta,
}: {
  label: string;
  value: string;
  help: string;
  delta: MetricDelta;
}): ReactElement => (
  <div className='rounded-xl border border-border bg-card px-5 py-4 shadow-sm'>
    <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>{label}</p>
    <div className='mt-1 flex items-baseline gap-3'>
      <span className='text-3xl font-semibold tabular-nums text-foreground'>{value}</span>
      <span className={cn('text-xs font-medium', toneClass(delta.tone))}>{delta.label}</span>
    </div>
    <p className='mt-1 text-xs text-muted-foreground'>{help}</p>
  </div>
);

const Tile = ({
  label,
  value,
  detail,
  tone = 'flat',
}: {
  label: string;
  value: string;
  detail: string;
  tone?: MetricDelta['tone'];
}): ReactElement => (
  <div className='rounded-xl border border-border bg-card px-4 py-3 shadow-sm'>
    <p className='text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>{label}</p>
    <p className='mt-1 text-xl font-semibold tabular-nums text-foreground'>{value}</p>
    <p className={cn('mt-0.5 text-[11px]', toneClass(tone))}>{detail}</p>
  </div>
);

export const MetricsOverview = ({ data }: { data: GlobalMetrics | AgentMetrics }): ReactElement => {
  const p50Delta = formatSignedMs(data.delta.p50TotalMs);
  const p95Delta = formatSignedMs(data.delta.p95TotalMs);
  const errorDelta = formatSignedPct(data.delta.errorRate);
  const concerns: string[] = [];
  if (data.totals.errorRate > 0.1)
    concerns.push(`error rate is ${formatPct(data.totals.errorRate)}`);
  if ((data.totals.p95TotalMs ?? 0) > 5 * 60_000) {
    concerns.push(`p95 is ${formatMs(data.totals.p95TotalMs)}`);
  }
  if ((data.delta.errorRate ?? 0) > 0.02) concerns.push('errors are trending upward');
  if ((data.delta.p95TotalMs ?? 0) > 30_000) concerns.push('tail latency is trending upward');
  const severe = data.totals.errorRate > 0.1 || concerns.length >= 3;

  return (
    <div className='flex flex-col gap-3'>
      <div
        className={cn(
          'rounded-xl border px-4 py-3 text-sm',
          concerns.length === 0 &&
            'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
          concerns.length > 0 &&
            !severe &&
            'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
          severe && 'border-destructive/30 bg-destructive/10 text-destructive',
        )}
      >
        {concerns.length === 0
          ? `Metrics look healthy across ${data.totals.runs} run${data.totals.runs === 1 ? '' : 's'}.`
          : `${concerns.length} concern${concerns.length === 1 ? '' : 's'}: ${concerns.join(' · ')}`}
      </div>

      <div className='grid gap-3 md:grid-cols-2'>
        <Hero
          label='Typical run time'
          value={formatMs(data.totals.p50TotalMs)}
          delta={p50Delta}
          help='Half of runs completed faster than this.'
        />
        <Hero
          label='Slow-tail run time'
          value={formatMs(data.totals.p95TotalMs)}
          delta={p95Delta}
          help='The slowest 5% completed at or above this time.'
        />
      </div>

      <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
        <Tile
          label='Total runs'
          value={String(data.totals.runs)}
          detail={`${data.delta.runs >= 0 ? '+' : ''}${data.delta.runs} vs previous`}
        />
        <Tile
          label='Where time goes'
          value={`${formatMs(data.totals.avgLlmMs)} LLM`}
          detail={`${formatMs(data.totals.avgToolMs)} in tools`}
        />
        <Tile
          label='Error rate'
          value={formatPct(data.totals.errorRate)}
          detail={errorDelta.label}
          tone={errorDelta.tone}
        />
        <Tile
          label='Outcomes'
          value={`${data.totals.completed} complete`}
          detail={`${data.totals.failed} failed · ${data.totals.cancelled} cancelled`}
        />
      </div>
    </div>
  );
};
