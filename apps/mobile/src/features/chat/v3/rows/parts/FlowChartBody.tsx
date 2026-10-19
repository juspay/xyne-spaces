import { memo, useCallback, useMemo, type ReactElement } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

import { pivotChartSeries, type ChartViewModel } from '@/src/utils/flowChartUtils';

import { useRecyclingState } from '../useRecyclingState';
import { FlowBarChart, FlowChartLegend, FlowPieChart } from './FlowChartParts';
import { seriesColor } from './FlowChartColors';
import { FlowLineAreaChart } from './FlowLineAreaChart';

type FlowChartBodyProps = {
  viewModel: ChartViewModel;
  height: number;
  mutedColor: string;
  borderColor: string;
  cardColor: string;
  recyclingKey: string;
};

export const FlowChartBody = memo(function FlowChartBody({
  viewModel,
  height,
  mutedColor,
  borderColor,
  cardColor,
  recyclingKey,
}: FlowChartBodyProps): ReactElement {
  const [width, setWidth] = useRecyclingState(`${recyclingKey}:chart-width`, 0);
  const onLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      const nextWidth = Math.floor(event.nativeEvent.layout.width);
      if (nextWidth > 0) {
        setWidth(current => (current === nextWidth ? current : nextWidth));
      }
    },
    [setWidth],
  );

  const legendItems = useMemo(() => {
    if (viewModel.kind === 'pie' || viewModel.kind === 'donut') {
      return viewModel.points.map((point, index) => ({
        label: point.label,
        color: seriesColor(index),
      }));
    }
    if (viewModel.kind === 'line' || viewModel.kind === 'area') {
      const { names } = pivotChartSeries(viewModel.series);
      if (names.length <= 1) return [];
      return names.map((name, index) => ({ label: name, color: seriesColor(index) }));
    }
    return [];
  }, [viewModel]);

  const chartHeight = Math.max(40, height - (legendItems.length > 0 ? 22 : 0));
  let chart: ReactElement | null = null;
  if (width > 0) {
    switch (viewModel.kind) {
      case 'bar':
        chart = (
          <FlowBarChart
            points={viewModel.points}
            width={width}
            height={chartHeight}
            mutedColor={mutedColor}
            borderColor={borderColor}
          />
        );
        break;
      case 'pie':
      case 'donut':
        chart = (
          <FlowPieChart
            points={viewModel.points}
            kind={viewModel.kind}
            width={width}
            height={chartHeight}
            cardColor={cardColor}
          />
        );
        break;
      case 'line':
      case 'area':
        chart = (
          <FlowLineAreaChart
            series={viewModel.series}
            kind={viewModel.kind}
            width={width}
            height={chartHeight}
            mutedColor={mutedColor}
            borderColor={borderColor}
          />
        );
        break;
    }
  }

  return (
    <View style={{ width: '100%', minHeight: height }} onLayout={onLayout}>
      <FlowChartLegend items={legendItems} mutedColor={mutedColor} />
      {chart ?? <View style={{ height }} />}
    </View>
  );
});
FlowChartBody.displayName = 'FlowChartBody';
