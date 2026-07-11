import { XYNE_FOUNDATION_TOKENS } from '../../../../themes/XYNE_FOUNDATION_TOKENS';

const C = XYNE_FOUNDATION_TOKENS.colors;
export const DASHBOARD_SERIES_COLORS: ReadonlyArray<string> = [
  C.green[500],
  C.gray[900],
  C.primary[500],
  C.purple[400],
  C.orange[400],
  C.yellow[400],
  C.red[500],
  C.green[600],
  C.primary[400],
  C.purple[600],
];

export const CHART_MARGIN = { top: 8, right: 8, left: 8, bottom: 0 } as const;

export const CHART_TICK_STYLE = {
  fill: 'var(--muted-foreground)',
  fontSize: 11,
  fontFamily: '"Geist Mono", monospace',
} as const;

export const CHART_GRID_STROKE_COLOR = 'var(--border)';
export const CHART_GRID_DASH = '3 3';

export const CHART_YAXIS_WIDTH = 80;
export const CHART_XAXIS_MIN_TICK_GAP = 24;

export const CHART_MAX_BAR_SIZE_PX = 96;
export const CHART_MIN_BAR_SLOT_PX = 48;

export const CHART_STROKE_WIDTH = 2;
export const CHART_AREA_FILL_OPACITY = 0.18;
export const CHART_ACTIVE_DOT_RADIUS = 4;

export const CHART_PIE_INNER_RADIUS = '58%';
export const CHART_PIE_OUTER_RADIUS = '88%';

export const CHART_LEGEND_HEIGHT = 30;
export const CHART_LEGEND_ICON_SIZE = 10;
export const CHART_LEGEND_STYLE = {
  fontSize: 12,
  color: 'var(--muted-foreground)',
  paddingBottom: 6,
} as const;

export const CHART_TOOLTIP_WRAPPER_STYLE = { outline: 'none' } as const;
