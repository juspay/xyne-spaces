import { type ReactElement } from 'react';
import { Sparkline } from './Sparkline';
import { METRIC_SPECS, VERDICT_STYLES, formatMetric } from '../../services/diagnostics/thresholds';
import type { MetricState } from '../../services/diagnostics';

interface MetricTileProps {
  metric: MetricState;
  range: 'session' | 'history';
}

export function MetricTile({ metric, range }: MetricTileProps): ReactElement {
  const spec = METRIC_SPECS[metric.key];
  const style = VERDICT_STYLES[metric.verdict];
  const points = range === 'history' ? metric.historyPoints : metric.points;

  return (
    <div className={`rounded-lg border p-3 ${style.border} ${style.bg}`}>
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0'>
          <div className='flex items-center gap-1.5'>
            <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden='true' />
            <span className='truncate text-xs font-medium text-neutral-600 dark:text-neutral-300'>
              {spec.label}
            </span>
          </div>
          <div className={`mt-1 text-xl font-semibold tabular-nums ${style.text}`}>
            {formatMetric(metric.key, metric.value)}
          </div>
        </div>
        <Sparkline points={points} className={style.text} width={90} height={26} />
      </div>

      <p className='mt-2 text-[11px] leading-snug text-neutral-500 dark:text-neutral-400'>
        {metric.supported ? spec.help : metric.unsupportedReason}
      </p>

      {metric.supported && metric.value !== null ? (
        <p className='mt-1 text-[11px] text-neutral-400 dark:text-neutral-500'>
          {style.label}
          {metric.verdict !== 'good' ? ` · ${describeTarget(metric.key)}` : ''}
        </p>
      ) : null}
    </div>
  );
}

/** States the band a healthy value sits in, so a red tile says what "better" means. */
function describeTarget(key: MetricState['key']): string {
  const spec = METRIC_SPECS[key];
  // A metric with a custom formatter is categorical (CPU pressure is a state
  // name, not a quantity), so quoting its numeric threshold would be gibberish.
  if (spec.format) return `good is below ${spec.format(spec.warnAt)}`;
  const suffix = spec.unit ? ` ${spec.unit}` : '';
  return spec.direction === 'lower'
    ? `good is under ${spec.warnAt}${suffix}`
    : `good is above ${spec.warnAt}${suffix}`;
}
