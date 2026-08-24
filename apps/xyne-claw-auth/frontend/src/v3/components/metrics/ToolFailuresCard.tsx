/**
 * Every failure class for one tool, paged.
 *
 * The overview card keeps only the top few classes per tool so it stays
 * readable. That cap hides the long tail — which is exactly where the rare,
 * fatal failure lives — so this is the drill-down: one tool, no rank cap.
 *
 * Purely presentational. The page owns the fetch so this component does not
 * need the filter context, and closing it stops the request.
 */

import { type ReactElement } from "react";
import type { ToolFailuresResponse } from "../../../lib/api";
import { MetricsDrawer } from "./MetricsDrawer";
import { PanelError, UnitBadge } from "./MetricsPrimitives";
import { STATUS } from "./metricsPalette";
import { formatCount, formatPct } from "./metricsFormat";

export function ToolFailuresCard({
  tool,
  data,
  loading,
  error,
  onOffset,
  onClose,
}: {
  tool: string;
  data: ToolFailuresResponse | undefined;
  loading: boolean;
  error: string | null;
  onOffset: (offset: number) => void;
  onClose: () => void;
}): ReactElement {
  const rows = data?.rows ?? [];
  const page = data?.page;
  const total = page?.total ?? 0;
  const occurrences = data?.occurrences ?? 0;

  const subtitle =
    loading && !data
      ? "Loading every failure class for this tool…"
      : total === 0
        ? "No errored calls for this tool in the window."
        : `${formatCount(total)} distinct failure class${total === 1 ? "" : "es"} across ${formatCount(occurrences)} errored call${occurrences === 1 ? "" : "s"}. Grouped by normalised message, ordered by frequency.`;

  return (
    <MetricsDrawer
      title={`All failures · ${tool}`}
      subtitle={
        <div className="flex flex-wrap items-center gap-2">
          <span>{subtitle}</span>
          <UnitBadge aggregation="cumulative" unit="occurrences" />
        </div>
      }
      onClose={onClose}
    >
      {error ? (
        <PanelError error={error} />
      ) : rows.length === 0 ? (
        <p className="py-6 text-[13px] text-xyne-fg-muted">
          {loading ? "Loading…" : "Nothing to show."}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.errorClass} className="rounded-lg bg-xyne-surface-sunken/60 px-3 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[12px] font-medium" style={{ color: STATUS.critical }}>
                    {row.errorClass}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-xyne-fg-muted">
                    {formatCount(row.occurrences)}×
                    {occurrences > 0 && ` · ${formatPct(row.occurrences / occurrences)}`}
                    {row.lastSeen && ` · last ${new Date(row.lastSeen).toLocaleString()}`}
                  </span>
                </div>
                {row.sample && (
                  <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-xyne-fg-muted">
                    {row.sample}
                  </p>
                )}
              </li>
            ))}
          </ul>

          {page && total > page.limit && (
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={page.offset === 0}
                onClick={() => onOffset(Math.max(0, page.offset - page.limit))}
                className="rounded-md border border-xyne-border px-2.5 py-1 text-[12px] font-medium text-xyne-fg-primary disabled:cursor-not-allowed disabled:opacity-40 hover:enabled:bg-xyne-surface-sunken"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page.offset + page.limit >= total}
                onClick={() => onOffset(page.offset + page.limit)}
                className="rounded-md border border-xyne-border px-2.5 py-1 text-[12px] font-medium text-xyne-fg-primary disabled:cursor-not-allowed disabled:opacity-40 hover:enabled:bg-xyne-surface-sunken"
              >
                Next
              </button>
              <span className="text-[12px] tabular-nums text-xyne-fg-muted">
                {Math.min(page.offset + 1, total)}–{Math.min(page.offset + rows.length, total)} of{" "}
                {formatCount(total)}
              </span>
            </div>
          )}
        </>
      )}
    </MetricsDrawer>
  );
}
