/**
 * Chart palette for the metrics page.
 *
 * Colours are declared once as CSS custom properties scoped to `.metrics-viz`,
 * and every chart references them by ROLE (`SERIES[0]`, `STATUS.critical`)
 * rather than by hex. Light/dark therefore swap in one place, and no chart
 * hard-codes a colour the way the original charts did (`#22c55e`, `#ef4444`, …
 * scattered across MetricsPageV3).
 *
 * ── Why not reuse the xyne status tokens for series ────────────────────────
 * Those are semantic roles (success/error/warning) and are needed here to mean
 * exactly that. A series slot that borrowed one would let a neutral category
 * impersonate a health signal. The two sets stay disjoint.
 *
 * ── Validation ────────────────────────────────────────────────────────────
 * Both sets were checked against this app's real surfaces — #ffffff light and
 * #171717 dark (--color-xyne-surface under `.dark`):
 *
 *   light  worst adjacent CVD ΔE 9.1 · normal-vision ΔE 19.6
 *          3 slots below 3:1 contrast → WARN
 *   dark   worst adjacent CVD ΔE 8.4 · normal-vision ΔE 19.3 · all PASS
 *
 * The light-mode contrast warning carries an obligation every chart here
 * honours: a legend or direct labels plus an adjacent table, so colour never
 * carries a value on its own.
 *
 * Status colours are deliberately NOT drawn from the series slots, and always
 * ship beside a text label rather than standing on hue alone. They double as
 * text colour in the tables, so each is held to WCAG AA for normal text —
 * 4.51:1 to 4.87:1 on white, 6.48:1 to 12.43:1 on the dark surface.
 */

import type { ReactElement } from "react";

/** Categorical slots, in fixed order. Never cycle past the end — fold to "Other". */
export const SERIES = [
  "var(--metrics-series-1)",
  "var(--metrics-series-2)",
  "var(--metrics-series-3)",
  "var(--metrics-series-4)",
  "var(--metrics-series-5)",
  "var(--metrics-series-6)",
] as const;

/** Fixed status roles. Always paired with a label — never hue alone. */
export const STATUS = {
  good: "var(--metrics-good)",
  warning: "var(--metrics-warning)",
  serious: "var(--metrics-serious)",
  critical: "var(--metrics-critical)",
} as const;

/** Single-hue ramp for magnitude (share bars, heat cells). */
export const SEQUENTIAL = {
  weak: "var(--metrics-seq-200)",
  mid: "var(--metrics-seq-400)",
  strong: "var(--metrics-seq-600)",
} as const;

export const NEUTRAL = {
  grid: "var(--metrics-grid)",
  axis: "var(--metrics-axis)",
  muted: "var(--metrics-muted-mark)",
  surface: "var(--metrics-surface)",
} as const;

/** Outcome colours. Status roles, not series slots — these describe health. */
export const OUTCOME = {
  completed: STATUS.good,
  failed: STATUS.critical,
  cancelled: NEUTRAL.muted,
} as const;

/** Recharts axis/tick styling shared by every chart, so they read as one system. */
export const AXIS_TICK = { fontSize: 11, fill: "currentColor", opacity: 0.65 } as const;
export const AXIS_LINE = { stroke: "currentColor", opacity: 0.18 } as const;
export const CHART_HEIGHT = 260;

/**
 * Injects the palette. Mount once inside the element carrying `.metrics-viz`.
 */
export function MetricsVizTokens(): ReactElement {
  return (
    <style>{`
      .metrics-viz {
        --metrics-series-1: #2a78d6;
        --metrics-series-2: #eb6834;
        --metrics-series-3: #1baf7a;
        --metrics-series-4: #eda100;
        --metrics-series-5: #e87ba4;
        --metrics-series-6: #4a3aa7;
        --metrics-good: #0a8a0a;
        --metrics-warning: #9a6700;
        --metrics-serious: #c2410c;
        --metrics-critical: #d03b3b;
        --metrics-seq-200: #9ec5f4;
        --metrics-seq-400: #3987e5;
        --metrics-seq-600: #184f95;
        --metrics-grid: rgba(100, 106, 120, 0.18);
        --metrics-axis: rgba(100, 106, 120, 0.32);
        --metrics-muted-mark: #94a3b8;
        --metrics-surface: #ffffff;
      }
      .dark .metrics-viz {
        --metrics-series-1: #3987e5;
        --metrics-series-2: #d95926;
        --metrics-series-3: #199e70;
        --metrics-series-4: #c98500;
        --metrics-series-5: #d55181;
        --metrics-series-6: #9085e9;
        --metrics-good: #4ade80;
        --metrics-warning: #fcd34d;
        --metrics-serious: #fb923c;
        --metrics-critical: #f87171;
        --metrics-seq-200: #86b6ef;
        --metrics-seq-400: #3987e5;
        --metrics-seq-600: #184f95;
        --metrics-grid: rgba(160, 168, 185, 0.16);
        --metrics-axis: rgba(160, 168, 185, 0.3);
        --metrics-muted-mark: #6b7280;
        --metrics-surface: #171717;
      }
    `}</style>
  );
}

/**
 * Health tone for a rate where higher is worse.
 *
 * Returned as a role, never a raw colour, so callers stay on the token set.
 */
export function rateTone(rate: number, warnAt = 0.05, badAt = 0.15): keyof typeof STATUS | null {
  if (rate >= badAt) return "critical";
  if (rate >= warnAt) return "serious";
  if (rate > 0) return "warning";
  return null;
}
