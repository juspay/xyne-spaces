import { ReactElement } from 'react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import type { KpiCompareData } from '@xyne/shared';
import { formatCompact } from './utils';

interface KpiCompareRendererProps {
  data: KpiCompareData;
  title?: string;
}

const KpiCompareRenderer = ({ data, title }: KpiCompareRendererProps): ReactElement => {
  const safe: KpiCompareData = {
    current: data && typeof data.current === 'number' ? data.current : NaN,
    previous: data && typeof data.previous === 'number' ? data.previous : NaN,
    label: data?.label,
    deltaPct: data?.deltaPct,
  };
  const label = safe.label ?? title ?? '';
  const hasPrecomputed = typeof safe.deltaPct === 'number' && Number.isFinite(safe.deltaPct);
  const hasBaseline =
    hasPrecomputed ||
    (Number.isFinite(safe.current) && Number.isFinite(safe.previous) && safe.previous !== 0);
  const deltaPct = hasPrecomputed
    ? (safe.deltaPct as number)
    : hasBaseline
      ? ((safe.current - safe.previous) / safe.previous) * 100
      : 0;

  const direction = deltaPct > 0 ? 'up' : deltaPct < 0 ? 'down' : 'flat';
  const Icon = direction === 'up' ? ArrowUp : direction === 'down' ? ArrowDown : Minus;
  const colorClass =
    direction === 'up'
      ? 'text-xyne-green-600'
      : direction === 'down'
        ? 'text-xyne-red-600'
        : 'text-muted-foreground';

  return (
    <div className='flex flex-col justify-center h-full px-6'>
      {label && (
        <div className='text-xs uppercase tracking-wider text-muted-foreground mb-1'>{label}</div>
      )}
      <div className='text-4xl font-semibold text-foreground tabular-nums'>
        {formatCompact(safe.current)}
      </div>
      <div className={`flex items-center gap-1 mt-2 text-sm ${colorClass}`}>
        <Icon className='w-3 h-3' />
        <span className='tabular-nums'>
          {hasBaseline ? `${Math.abs(deltaPct).toFixed(1)}%` : '—'}
        </span>
        <span className='text-muted-foreground ml-1'>vs {formatCompact(safe.previous)}</span>
      </div>
    </div>
  );
};

export default KpiCompareRenderer;
