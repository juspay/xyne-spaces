/**
 * Pose-0 Union from Figma 1739:101972 (viewBox 974×1554, body 890×1400).
 * Topology is identical across poses 1/0/-1/-2/-3; only tab vertices move.
 * `tabOffset` is design px relative to pose 0: −100 covering, 0 open, +100/+200/+300 under.
 */

const fmt = (value: number): string => {
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
};

export const TAB_STEP = 100;
export const GLYPH_W = 890;
export const GLYPH_H = 1400;
export const GLYPH_VIEW_W = 974;
export const GLYPH_VIEW_H = 1554;

export const folderFillPath = (tabOffset: number): string => {
  const y = (base: number): string => fmt(base + tabOffset);
  return `M932 1407H80V${y(506.838)}C80 ${y(500.236)} 74.0736 ${y(495.072)} 69.3418 ${y(490.469)}L46.8428 ${y(468.58)}C43.7467 ${y(465.568)} 42.0001 ${y(461.432)} 42 ${y(457.112)}V${y(305.888)}C42.0001 ${y(301.568)} 43.7467 ${y(297.432)} 46.8428 ${y(294.42)}L69.3418 ${y(272.531)}C74.0738 ${y(267.928)} 80 ${y(262.763)} 80 ${y(256.161)}V7H932V1407Z`;
};

export const folderStrokePath = (tabOffset: number): string => {
  const y = (base: number): string => fmt(base + tabOffset);
  return `M931.5 7.5V1406.5H80.5V${y(506.838)}C80.5 ${y(503.381)} 78.9475 ${y(500.333)} 76.8418 ${y(497.599)}C74.7407 ${y(494.871)} 72.0394 ${y(492.395)} 69.6904 ${y(490.11)}L47.1914 ${y(468.222)}C44.1921 ${y(465.304)} 42.5001 ${y(461.297)} 42.5 ${y(457.112)}V${y(305.888)}L42.5049 ${y(305.496)}C42.607 ${y(301.454)} 44.2858 ${y(297.605)} 47.1914 ${y(294.778)}L69.6904 ${y(272.89)}C72.0395 ${y(270.604)} 74.7407 ${y(268.129)} 76.8418 ${y(265.4)}C78.9474 ${y(262.666)} 80.4999 ${y(259.618)} 80.5 ${y(256.161)}V7.5H931.5Z`;
};
