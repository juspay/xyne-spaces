/**
 * Themed tooltip for the metrics charts.
 *
 * Shares the visual language of the page's existing tooltip but adds two things
 * the deep panels need: a `format` callback that receives the whole datum (so a
 * row can show sample size or a derived share alongside its value), and a
 * `labelFormat` for axis categories that need a unit spelled out.
 *
 * A chart is interactive by default, so every chart here ships one.
 */

import type { ReactElement } from "react";

export interface TooltipPayloadItem {
  name?: string | undefined;
  value?: number | string | undefined;
  color?: string | undefined;
  dataKey?: string | number | undefined;
  payload?: Record<string, unknown> | undefined;
}

export interface MetricsTooltipProps {
  /** Injected by Recharts when it clones this element. */
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  /** Formats one row's value. `item` is the full datum, for derived context. */
  format?: (
    value: number | string | undefined,
    name: string | undefined,
    item: Record<string, unknown> | undefined,
  ) => string;
  /** Overrides the heading; defaults to the category label. */
  labelFormat?: (label: string | number) => string;
  /** Hides rows whose value is null/undefined rather than printing "—". */
  hideEmpty?: boolean;
}

export function MetricsTooltip({
  active,
  payload,
  label,
  format,
  labelFormat,
  hideEmpty = true,
}: MetricsTooltipProps): ReactElement | null {
  if (!active || !payload || payload.length === 0) return null;

  const rows = payload.filter((p) => !hideEmpty || p.value != null);
  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-xyne-border bg-xyne-surface px-3 py-2 shadow-md">
      {label != null && (
        <div className="mb-1.5 text-[12px] font-medium text-xyne-fg-primary">
          {labelFormat ? labelFormat(label) : String(label)}
        </div>
      )}
      <ul className="flex flex-col gap-1">
        {rows.map((row, i) => (
          <li key={`${String(row.dataKey)}-${i}`} className="flex items-center gap-2 text-[12px]">
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: row.color ?? "currentColor" }}
            />
            <span className="text-xyne-fg-muted">{row.name ?? String(row.dataKey ?? "")}</span>
            <span className="ml-auto pl-3 font-medium tabular-nums text-xyne-fg-primary">
              {format ? format(row.value, row.name, row.payload) : String(row.value ?? "—")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
