export type CardinalityOption = 'TOP_3' | 'TOP_5' | 'TOP_10' | 'TOP_15' | 'TOP_20';

export interface ChartDataPoint {
  [key: string]: string | number;
}

export interface GroupbyConfig {
  groupbyKeys: string[];
  timeColumn: string;
  metricColumns: string[];
  cardinality?: CardinalityOption;
  showCardinality?: boolean;
}

export interface MetricConfig {
  metric_name_db: string;
  metric_label: string;
  metric_type: 'Rate' | 'Volume' | 'Amount' | 'Latency' | 'Count';
  metric_key?: string;
  thresholdVal?: number;
  step_up_threshold?: number;
}

export interface MediaAsset {
  mimeType: string;
  kind?: 'image' | 'video';
  url?: string;
  base64?: string;
  alt?: string;
  name?: string;
  poster?: string;
  controls?: boolean;
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
}

export type SingleStatPayload = { metric: string; value: string | number } | unknown[];

export interface ToolOutput {
  id: string;
  description?: string;
  /** Legacy Highcharts options — not rendered locally, kept for type compat */
  chartData?: unknown;
  rawChartData?: ChartDataPoint[];
  groupbyConfig?: GroupbyConfig;
  selectedMetrics?: MetricConfig;
  singleStat?: SingleStatPayload;
  tableData?: Record<string, string | number>[];
  barChartData?: {
    rawData: Record<string, string | number>[];
    groupKey: string;
    selectedMetrics: MetricConfig;
    isHorizontalBar?: boolean;
  };
  volumeChartData?: {
    rawData: Record<string, string | number>[];
    groupKey: string;
    selectedMetrics: MetricConfig;
    defaultChartType?: 'bar' | 'pie';
    showToggle?: boolean;
    title?: string;
  };
  /** Agentic chart response — not rendered locally */
  agenticChartData?: unknown;
  /** Direct chart options — not rendered locally */
  directChartData?: unknown;
  showAddToBoardButton?: boolean;
  qapiComponentData?: Record<string, unknown> | Record<string, unknown>[];
  imageData?: MediaAsset | MediaAsset[];
  videoData?: MediaAsset | MediaAsset[];
}
