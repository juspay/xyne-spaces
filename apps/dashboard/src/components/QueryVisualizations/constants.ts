/**
 * Chart Visualization Constants and Color Schemes
 */

export const CHART_COLORS = {
  // Primary palette
  primary: '#2B7FFF',
  secondary: '#8200DB',
  accent: '#FF6900',
  success: '#00C951',
  warning: '#FF6900',
  error: '#FB2C36',
  info: '#1447E6',

  // Extended palette for multi-series charts
  series: [
    '#2B7FFF', // Blue
    '#8200DB', // Purple
    '#FF6900', // Orange
    '#00C951', // Green
    '#FB2C36', // Red
    '#FFB86A', // Light Orange
    '#AD46FF', // Light Purple
    '#00D492', // Light Green
    '#FF8904', // Orange variant
    '#51A2FF', // Light Blue
  ],

  // Gray palette
  gray: {
    50: '#F5F7FA',
    100: '#E1E4EA',
    200: '#CACFD8',
    300: '#99A0AE',
    400: '#717784',
    500: '#525866',
    600: '#363B48',
    700: '#222530',
    800: '#181B25',
    900: '#0E121B',
  },

  // Semantic colors
  status: {
    open: '#2B7FFF',
    resolved: '#00C951',
    pending: '#FF6900',
    critical: '#FB2C36',
  },
};

export const CHART_SPACING = {
  xs: 2,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
};

export const CHART_BORDER_RADIUS = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
};

export const HEATMAP_COLORS = [
  '#0E121B', // Very dark (low)
  '#182E5C',
  '#1C398E',
  '#1C398E',
  '#1947C0',
  '#1447E6',
  '#2B7FFF',
  '#51A2FF',
  '#8EC5FF',
  '#BEDBFF', // Very light (high)
];

export const CHART_ANIMATION_DURATION = 300;
