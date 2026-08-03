import { QueryVisualizationType } from '@xyne/shared';
import { getRendererForType } from '../../DynamicDashboard/ComponentGrid/renderers';
import {
  CHART_XAXIS_MIN_TICK_GAP,
  CHART_YAXIS_WIDTH,
} from '../../DynamicDashboard/ComponentGrid/renderers/constants';
import { formatTimeTick } from '../../DynamicDashboard/ComponentGrid/renderers/utils';
import type { ChartBlockPayload } from './ChartBlock.types';

// Approximate rendered width of one character at CHART_TICK_STYLE
// (fontSize 11, "Geist Mono"). Monospace makes this a reliable estimate:
// ~0.6em per glyph. Slightly generous on purpose — over-reserving costs a
// little scroll, under-reserving silently drops the label.
const CHART_TICK_CHAR_PX = 6.6;

/**
 * Parse a ```chart fence into a payload with a NARROWED visualType.
 *
 * The fence is plain text in the model's reply, so it can arrive malformed or
 * hand-written rather than copied from the `visualize` tool. Narrowing here —
 * against the renderer registry, the same source of truth ChartBlock renders
 * from — means the component never handles a raw string visualType and an
 * unrenderable type is rejected once, at the boundary.
 *
 * Returns null while the JSON is still incomplete (streaming) as well as for
 * genuinely invalid payloads; ChartBlock shows its loading state for both,
 * matching how FilesystemBlock treats partial input.
 */
export function parseChartJSON(source: string): ChartBlockPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const { title, visualType, data } = parsed as Record<string, unknown>;
  if (typeof title !== 'string' || typeof visualType !== 'string') return null;
  if (data === undefined) return null;

  const narrowed = asRenderableVisualType(visualType);
  if (!narrowed) return null;

  return { title, visualType: narrowed, data };
}

/** A visualType string is renderable only if the registry has a renderer for it. */
function asRenderableVisualType(value: string): QueryVisualizationType | null {
  const candidate = value as QueryVisualizationType;
  return getRendererForType(candidate) ? candidate : null;
}

export function isValidChartJSON(source: string): boolean {
  return parseChartJSON(source) !== null;
}

/**
 * Minimum content width a chart needs for every x-axis label to stay visible,
 * or 0 when the type has no text x-axis (pie/donut/kpi/table).
 *
 * Recharts drops ticks rather than overflowing when labels would collide, so a
 * narrow surface silently loses its axis. Reserving width here and letting the
 * container scroll keeps every label.
 *
 * Width is derived from the LABELS, not a fixed per-item slot. The existing
 * CHART_MIN_BAR_SLOT_PX (48px) sizes a *bar*, but an 8-character label at
 * fontSize 11 monospace is ~53px and needs another CHART_XAXIS_MIN_TICK_GAP
 * (24px) of clearance — so a fixed 48px slot under-reserves by ~40% and the
 * labels drop anyway. We measure the widest rendered label instead.
 *
 * Labels are measured AS DISPLAYED: line/area run `x` through formatTimeTick
 * (an ISO date renders as "Jul 1"), so measuring the raw value would badly
 * over-reserve.
 *
 * Distinct x positions are counted, not rows — `[{x:'Mon',series:'a'},
 * {x:'Mon',series:'b'}]` is ONE slot, so a 2-series 10-point chart doesn't
 * reserve 20 slots' worth of width.
 */
export function chartMinContentWidth(visualType: QueryVisualizationType, data: unknown): number {
  const key = X_LABEL_KEY[visualType];
  if (!key || !Array.isArray(data) || data.length === 0) return 0;

  const usesTimeFormat = TIME_FORMATTED_TYPES.has(visualType);
  const labels = new Set<string>();
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const raw = (row as Record<string, unknown>)[key];
    // Only the shapes the contract allows (string | number | Date); anything
    // else would stringify to '[object Object]' and collapse distinct rows.
    let text: string;
    if (raw instanceof Date) text = raw.toISOString();
    else if (typeof raw === 'string') text = raw;
    else if (typeof raw === 'number' && Number.isFinite(raw)) text = String(raw);
    else continue;
    labels.add(usesTimeFormat ? formatTimeTick(text) : text);
  }
  if (labels.size === 0) return 0;

  let widest = 0;
  for (const l of labels) widest = Math.max(widest, l.length * CHART_TICK_CHAR_PX);
  const slot = widest + CHART_XAXIS_MIN_TICK_GAP;
  return labels.size * slot + CHART_YAXIS_WIDTH;
}

/** Which field supplies the x-axis label, per chart type. */
const X_LABEL_KEY: Partial<Record<QueryVisualizationType, string>> = {
  [QueryVisualizationType.BAR_CHART]: 'label',
  [QueryVisualizationType.LINE_CHART]: 'x',
  [QueryVisualizationType.AREA_CHART]: 'x',
  [QueryVisualizationType.SCATTER_CHART]: 'x',
};

/** Types whose XAxis passes ticks through formatTimeTick before rendering. */
const TIME_FORMATTED_TYPES: ReadonlySet<QueryVisualizationType> = new Set([
  QueryVisualizationType.LINE_CHART,
  QueryVisualizationType.AREA_CHART,
]);
