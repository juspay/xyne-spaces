/**
 * Component Tokens Index
 *
 * Exports theme provider compatible component tokens.
 */

import { StatCard, StatCardDark } from './statcard.tokens';
import { Charts, ChartsDark } from './chart.tokens';

// Export light theme component tokens
export const XYNE_THEME_COMPONENT_TOKENS = {
  STAT_CARD: StatCard,
  CHARTS: Charts,
};

// Export dark theme component tokens
export const XYNE_THEME_COMPONENT_TOKENS_DARK = {
  STAT_CARD: StatCardDark,
  CHARTS: ChartsDark,
};
