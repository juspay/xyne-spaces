import { memo, type ReactElement } from 'react';
import { QueryVisualizationType } from '@xyne/shared';
import { getRendererForType } from '../../DynamicDashboard/ComponentGrid/renderers';
import { parseChartJSON, chartMinContentWidth } from './ChartBlock.utils';
import type { ChartBlockProps } from './ChartBlock.types';

const HEIGHT_BY_TYPE: Partial<Record<QueryVisualizationType, string>> = {
  [QueryVisualizationType.KPI]: 'h-28',
  [QueryVisualizationType.KPI_COMPARE]: 'h-28',
  [QueryVisualizationType.DATA_TABLE]: 'h-80',
};
const DEFAULT_HEIGHT = 'h-56';

const ChartBlockComponent = ({ jsonSource }: ChartBlockProps): ReactElement => {
  const payload = parseChartJSON(jsonSource);

  if (!payload) {
    return (
      <div className='my-4 p-4 bg-muted/50 border border-border rounded-lg'>
        <div className='flex items-center justify-center gap-2'>
          <div className='animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full' />
          <p className='text-sm text-muted-foreground'>Rendering chart...</p>
        </div>
      </div>
    );
  }

  const { title, visualType, data } = payload;
  // Non-null: parseChartJSON only returns types the registry can render.
  const Renderer = getRendererForType(visualType)!;

  const minWidth = chartMinContentWidth(visualType, data);

  return (
    <div className='my-4 rounded-lg border border-border bg-card p-3'>
      <div className='mb-2 text-sm font-medium text-foreground'>{title}</div>
      <div
        className={`${HEIGHT_BY_TYPE[visualType] ?? DEFAULT_HEIGHT} ${
          minWidth > 0 ? 'overflow-x-auto overflow-y-hidden' : ''
        }`}
      >
        <div className='h-full' {...(minWidth > 0 ? { style: { minWidth } } : {})}>
          <Renderer data={data} title={title} />
        </div>
      </div>
    </div>
  );
};

export const ChartBlock = memo(
  ChartBlockComponent,
  (prev, next) => prev.jsonSource === next.jsonSource,
);
