import { ReactElement } from 'react';
import type { KpiData } from '@xyne/shared';
import { formatCompact } from './utils';

interface KpiRendererProps {
  data: KpiData;
  title?: string;
}

const KpiRenderer = ({ data, title }: KpiRendererProps): ReactElement => {
  const value =
    data && typeof data === 'object' && typeof data.value === 'number' ? data.value : NaN;
  const label = (data as KpiData | undefined)?.label ?? title ?? '';
  return (
    <div className='flex flex-col justify-center h-full px-6'>
      {label && (
        <div className='text-xs uppercase tracking-wider text-muted-foreground mb-1'>{label}</div>
      )}
      <div className='text-4xl font-semibold text-foreground tabular-nums'>
        {formatCompact(value)}
      </div>
    </div>
  );
};

export default KpiRenderer;
