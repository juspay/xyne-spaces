import { ReactElement } from 'react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import type { KpiCompareData } from '@xyne/shared';
import { formatKpiValue, type UnitPosition } from './utils';

interface KpiCompareRendererProps {
  data: KpiCompareData;
  title?: string;
  unit?: string;
  unitPosition?: UnitPosition;
}

const KpiCompareRenderer = ({
  data,
  unit,
  unitPosition,
}: KpiCompareRendererProps): ReactElement => {
  const safe: KpiCompareData = {
    current: data && typeof data.current === 'number' ? data.current : NaN,
    previous: data && typeof data.previous === 'number' ? data.previous : NaN,
    label: data?.label,
    deltaPct: data?.deltaPct,
  };
  const label = safe.label ?? '';
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
        <div className='text-[10px] uppercase tracking-[0.16em] font-medium text-muted-foreground mb-2'>
          {label}
        </div>
      )}
      <div className='font-mono text-5xl font-semibold text-foreground tabular-nums tracking-tight leading-none'>
        {formatKpiValue(safe.current, unit, unitPosition)}
      </div>
      <div className={`flex items-center gap-1.5 mt-3 text-[13px] font-medium ${colorClass}`}>
        <Icon className='w-3.5 h-3.5' strokeWidth={2.5} />
        <span className='tabular-nums'>
          {hasBaseline ? `${Math.abs(deltaPct).toFixed(1)}%` : '—'}
        </span>
        <span className='text-muted-foreground ml-1 font-normal'>
          vs {formatKpiValue(safe.previous, unit, unitPosition)}
        </span>
      </div>
    </div>
  );
};

export default KpiCompareRenderer;
