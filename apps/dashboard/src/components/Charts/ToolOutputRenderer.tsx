import React from 'react';
import type { ToolOutput } from '../../types/toolOutput';
import TimeSeriesChart from './TimeSeriesChart';
import BarChart1D from './BarChart1D';
import VolumeChart from './VolumeChart';
import SingleStat from './SingleStat';
import SimpleTable from './SimpleTable';

export interface ToolOutputRendererProps {
  toolOutput: ToolOutput;
  className?: string;
  style?: React.CSSProperties;
  isMobile?: boolean;
}

const ToolOutputRenderer: React.FC<ToolOutputRendererProps> = ({
  toolOutput,
  className,
  style,
  isMobile = false,
}) => {
  const wrapper = (children: React.ReactNode) => (
    <div className={className} style={style}>
      {children}
    </div>
  );

  if (toolOutput.rawChartData && toolOutput.groupbyConfig && toolOutput.selectedMetrics) {
    return wrapper(
      <TimeSeriesChart
        rawChartData={toolOutput.rawChartData}
        groupbyConfig={toolOutput.groupbyConfig}
        selectedMetrics={toolOutput.selectedMetrics}
        enableGroupby
        showCardinalityControl
        isMobile={isMobile}
      />,
    );
  }

  if (toolOutput.barChartData) {
    const { rawData, groupKey, selectedMetrics, isHorizontalBar = true } = toolOutput.barChartData;
    return wrapper(
      <BarChart1D
        rawData={rawData}
        groupKey={groupKey}
        selectedMetrics={selectedMetrics}
        isHorizontalBar={isHorizontalBar}
        isMobile={isMobile}
      />,
    );
  }

  if (toolOutput.volumeChartData) {
    const { rawData, groupKey, selectedMetrics, defaultChartType, showToggle, title } =
      toolOutput.volumeChartData;
    return wrapper(
      <VolumeChart
        rawData={rawData}
        groupKey={groupKey}
        selectedMetrics={selectedMetrics}
        {...(defaultChartType !== undefined && { defaultChartType })}
        {...(showToggle !== undefined && { showToggle })}
        {...(title !== undefined && { title })}
        isMobile={isMobile}
      />,
    );
  }

  if (toolOutput.singleStat && !Array.isArray(toolOutput.singleStat)) {
    const ss = toolOutput.singleStat as { metric: string; value: string | number };
    return wrapper(<SingleStat metric={ss.metric} value={ss.value} />);
  }

  if (toolOutput.tableData && toolOutput.tableData.length > 0) {
    return wrapper(<SimpleTable data={toolOutput.tableData} />);
  }

  return null;
};

export default ToolOutputRenderer;
