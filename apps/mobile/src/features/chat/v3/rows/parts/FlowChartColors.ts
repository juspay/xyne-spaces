export const CHART_SERIES_COLORS = ['#e76f51', '#2a9d8f', '#264653', '#e9c46a', '#f4a261'] as const;

export const seriesColor = (index: number): string =>
  CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length]!;
