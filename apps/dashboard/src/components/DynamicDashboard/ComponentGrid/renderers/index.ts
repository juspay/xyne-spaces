import { ReactElement } from 'react';
import { QueryVisualizationType } from '@xyne/shared';
import type { UnitPosition } from './utils';
import BarChartRenderer from './BarChartRenderer';
import LineChartRenderer from './LineChartRenderer';
import AreaChartRenderer from './AreaChartRenderer';
import PieChartRenderer from './PieChartRenderer';
import KpiRenderer from './KpiRenderer';
import KpiCompareRenderer from './KpiCompareRenderer';
import ScatterRenderer from './ScatterRenderer';
import TableRenderer from './TableRenderer';

export {
  BarChartRenderer,
  LineChartRenderer,
  AreaChartRenderer,
  PieChartRenderer,
  KpiRenderer,
  KpiCompareRenderer,
  ScatterRenderer,
  TableRenderer,
};

export type ComponentRenderer = (props: {
  data: unknown;
  title?: string;
  unit?: string;
  unitPosition?: UnitPosition;
}) => ReactElement;

const REGISTRY: Partial<Record<QueryVisualizationType, ComponentRenderer>> = {
  [QueryVisualizationType.BAR_CHART]: BarChartRenderer as ComponentRenderer,
  [QueryVisualizationType.LINE_CHART]: LineChartRenderer as ComponentRenderer,
  [QueryVisualizationType.AREA_CHART]: AreaChartRenderer as ComponentRenderer,
  [QueryVisualizationType.PIE_CHART]: PieChartRenderer as ComponentRenderer,
  [QueryVisualizationType.DONUT_CHART]: PieChartRenderer as ComponentRenderer,
  [QueryVisualizationType.KPI]: KpiRenderer as ComponentRenderer,
  [QueryVisualizationType.KPI_COMPARE]: KpiCompareRenderer as ComponentRenderer,
  [QueryVisualizationType.SCATTER_CHART]: ScatterRenderer as ComponentRenderer,
  [QueryVisualizationType.DATA_TABLE]: TableRenderer as ComponentRenderer,
};

export function getRendererForType(
  visualType: QueryVisualizationType,
): ComponentRenderer | undefined {
  return REGISTRY[visualType];
}
