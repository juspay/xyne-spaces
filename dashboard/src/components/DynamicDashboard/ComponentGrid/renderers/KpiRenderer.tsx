import { ReactElement } from 'react';
import type { KpiData } from '@xyne/shared';
import { formatKpiValue, type UnitPosition } from './utils';

interface KpiRendererProps {
  data: KpiData;
  title?: string;
  unit?: string;
  unitPosition?: UnitPosition;
}

const KpiRenderer = ({ data, unit, unitPosition }: KpiRendererProps): ReactElement => {
  const value =
    data && typeof data === 'object' && typeof data.value === 'number' ? data.value : NaN;
  const label = (data as KpiData | undefined)?.label ?? '';
  return (
    <div className='flex flex-col justify-center h-full px-6'>
      {label && (
        <div className='text-[10px] uppercase tracking-[0.16em] font-medium text-muted-foreground mb-2'>
          {label}
        </div>
      )}
      <div className='font-mono text-5xl font-semibold text-foreground tabular-nums tracking-tight leading-none'>
        {formatKpiValue(value, unit, unitPosition)}
      </div>
    </div>
  );
};

export default KpiRenderer;
