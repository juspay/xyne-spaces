/**
 * Shared building blocks for the metrics panels.
 *
 * Extracted so the deep panels stay consistent with the cards MetricsPageV3
 * already renders — same card shell, same table type scale — and old and new
 * sections read as one screen rather than two bolted together.
 *
 * `CoverageNotice` and the "n/a" handling in `SortableTable` exist for one
 * reason: several of these metrics can be legitimately unknown (backfill not
 * finished, nothing citeable, no declared schema). Rendering unknown as zero
 * would turn missing data into a false finding, so unknown is always shown as
 * unknown.
 */

import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Info, Search, TriangleAlert, X } from "lucide-react";
import { cn } from "../../../lib/utils";
import { NEUTRAL, SEQUENTIAL, STATUS } from "./metricsPalette";

export const th = "py-2 pr-3 text-[11px] font-medium uppercase tracking-wider text-xyne-fg-muted";
export const td = "py-2 pr-3 text-[13px] text-xyne-fg-primary";

/* ── Card shell ───────────────────────────────────────────────────────────── */

export function MetricsCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="rounded-xl bg-xyne-surface p-[20px] shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[14px] font-semibold text-xyne-fg-primary">{title}</h2>
          {description && (
            <p className="mt-0.5 text-[12px] text-xyne-fg-muted">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/* ── Unit / aggregation badge ─────────────────────────────────────────────── */

/**
 * States HOW a number was aggregated and in what unit.
 *
 * "Tool time: 4.2m" is ambiguous — summed across every call, or the typical
 * call? The two differ by orders of magnitude and lead to opposite decisions.
 * Every chart and tile that shows an aggregate carries one of these, so the
 * reader never has to infer it from the axis.
 */
export type Aggregation = "cumulative" | "average" | "median" | "p95" | "distinct" | "rate" | "share" | "max";

const AGGREGATION_LABEL: Record<Aggregation, string> = {
  cumulative: "Σ cumulative",
  average: "x̄ average",
  median: "p50 median",
  p95: "p95 tail",
  distinct: "# distinct",
  rate: "% rate",
  share: "% share",
  max: "↑ max",
};

export function UnitBadge({
  aggregation,
  unit,
  hint,
}: {
  aggregation: Aggregation;
  /** The measurement unit, e.g. "ms", "MB", "calls", "tok/s". */
  unit: string;
  hint?: string;
}): ReactElement {
  return (
    <span
      title={hint ?? `${AGGREGATION_LABEL[aggregation]}, measured in ${unit}`}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-xyne-border-subtle bg-xyne-surface-sunken px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-xyne-fg-muted"
    >
      <span>{AGGREGATION_LABEL[aggregation]}</span>
      <span aria-hidden className="opacity-40">·</span>
      <span>{unit}</span>
    </span>
  );
}

/* ── Segmented control ────────────────────────────────────────────────────── */

/** Small inline switch for picking which measure a chart plots. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}): ReactElement {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex shrink-0 items-center gap-0.5 rounded-full bg-xyne-surface-sunken p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
            value === option.id
              ? "bg-xyne-fg-primary text-xyne-fg-inverse"
              : "text-xyne-fg-muted hover:text-xyne-fg-primary",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ── Stat tiles ───────────────────────────────────────────────────────────── */

export type Tone = "neutral" | "good" | "warning" | "serious" | "critical";

/**
 * A single number with its label and optional supporting detail.
 *
 * The value is the largest thing in the tile; the label sits above it in muted
 * text so a scan reads values first, labels second.
 */
export function StatTile({
  label,
  value,
  detail,
  tone = "neutral",
  hint,
  aggregation,
  unit,
}: {
  label: string;
  value: string;
  detail?: string | undefined;
  tone?: Tone;
  hint?: string | undefined;
  /** Renders a unit badge under the value — states how the number was aggregated. */
  aggregation?: Aggregation | undefined;
  unit?: string | undefined;
}): ReactElement {
  return (
    <div className="rounded-xl bg-xyne-surface px-4 py-3 shadow-sm">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-xyne-fg-muted">{label}</span>
        {hint && (
          <span title={hint} className="text-xyne-fg-muted/70">
            <Info size={12} aria-hidden />
            <span className="sr-only">{hint}</span>
          </span>
        )}
      </div>
      <div
        className="mt-1 text-[20px] font-semibold tabular-nums text-xyne-fg-primary"
        style={tone === "neutral" ? undefined : { color: STATUS[tone] }}
      >
        {value}
      </div>
      {detail && <div className="mt-0.5 text-[11px] text-xyne-fg-muted">{detail}</div>}
      {aggregation && unit && (
        <div className="mt-1.5">
          <UnitBadge aggregation={aggregation} unit={unit} />
        </div>
      )}
    </div>
  );
}

/* ── Coverage / caveat banner ─────────────────────────────────────────────── */

/**
 * States that a panel's numbers describe only part of the window.
 *
 * Always rendered when coverage < 1 — a partially summarised window makes every
 * count look low, and without this the shortfall reads as a real decline.
 */
export function CoverageNotice({
  coverage,
  total,
  covered,
  unit,
  remedy,
}: {
  coverage: number;
  total: number;
  covered: number;
  unit: string;
  remedy: string;
}): ReactElement | null {
  if (total === 0 || coverage >= 0.999) return null;
  return (
    <div className="flex items-start gap-2 rounded-xl border border-xyne-warning-border bg-xyne-warning-bg px-3 py-2 text-[12px] text-xyne-warning-fg">
      <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
      <p>
        <span className="font-medium">
          Partial data — {Math.round(coverage * 100)}% of {unit} in this window.
        </span>{" "}
        {covered.toLocaleString()} of {total.toLocaleString()} carry these metrics, so every count
        below under-reports. {remedy}
      </p>
    </div>
  );
}

/* ── Share bar ────────────────────────────────────────────────────────────── */

/**
 * Proportion of a whole, as a track plus its value.
 *
 * The number is always present beside the bar — the bar is the comparison, the
 * label is the value, so the reader never has to estimate from length.
 */
export function ShareBar({
  share,
  label,
  emphasis,
}: {
  share: number;
  label: string;
  emphasis?: boolean;
}): ReactElement {
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-[80px] shrink-0 overflow-hidden rounded-full"
        style={{ backgroundColor: NEUTRAL.grid }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(100, Math.max(0, share * 100))}%`,
            backgroundColor: emphasis ? STATUS.serious : SEQUENTIAL.mid,
          }}
        />
      </div>
      <span className="w-[64px] shrink-0 text-right text-[11px] tabular-nums text-xyne-fg-muted">
        {label}
      </span>
    </div>
  );
}

/* ── Chart legend ─────────────────────────────────────────────────────────── */

/** Rendered outside the SVG so its text wears text tokens, not the series colour. */
export function ChartLegend({
  items,
  className,
}: {
  items: Array<{ color: string; label: string }>;
  className?: string;
}): ReactElement {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1", className)}>
      {items.map((item) => (
        <li
          key={item.label}
          className="flex items-center gap-1.5 text-[11px] text-xyne-fg-muted"
        >
          <span
            aria-hidden
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/* ── Sortable table ───────────────────────────────────────────────────────── */

export interface Column<T> {
  key: string;
  header: string;
  /** Right-align numeric columns so digits line up for comparison. */
  numeric?: boolean;
  /** Omit to make the column unsortable. */
  sortValue?: (row: T) => number | string | null;
  render: (row: T) => ReactNode;
  hint?: string;
}

/**
 * Server-driven paging. Present = the caller owns sort and page state.
 *
 * A paged table CANNOT sort locally: ranking the 50 rows that happen to be
 * loaded and labelling the result "worst tools" is more misleading than not
 * sorting at all. So when this is set, header clicks and page buttons call
 * back rather than mutating local state.
 */
export interface ServerPaging {
  limit: number;
  offset: number;
  /** Rows matching the current search across the whole window. */
  total: number;
  sort: string;
  dir: "asc" | "desc";
  onSort: (key: string) => void;
  onOffset: (offset: number) => void;
  search: string;
  onSearch: (query: string) => void;
  searchPlaceholder?: string;
  /** Shown beside the range, e.g. "tools". */
  unit: string;
}

/**
 * The one table used by every new panel.
 *
 * Two modes. Without `paging`, rows are sorted and truncated locally — right
 * for a bounded list like the agent roster. With `paging`, the server owns sort
 * and slice, because the full set is too large to ship.
 */
export function SortableTable<T>({
  rows,
  columns,
  defaultSort,
  defaultDirection = "desc",
  emptyMessage,
  rowKey,
  maxRows = 12,
  paging,
}: {
  rows: T[];
  columns: Array<Column<T>>;
  defaultSort: string;
  defaultDirection?: "asc" | "desc";
  emptyMessage: string;
  rowKey: (row: T) => string;
  maxRows?: number;
  paging?: ServerPaging;
}): ReactElement {
  const [sortKey, setSortKey] = useState(defaultSort);
  const [direction, setDirection] = useState<"asc" | "desc">(defaultDirection);
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(() => {
    // Server mode: the rows arrive already ordered. Re-sorting here would
    // reorder one page against itself and misrepresent it as a ranking.
    if (paging) return rows;
    const col = columns.find((c) => c.key === sortKey);
    const sortValue = col?.sortValue;
    if (!sortValue) return rows;
    const factor = direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = sortValue(a);
      const bv = sortValue(b);
      // Nulls sort last in both directions — "unknown" is never "worst".
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === "string" || typeof bv === "string") {
        return factor * String(av).localeCompare(String(bv));
      }
      return factor * (av - bv);
    });
  }, [rows, columns, sortKey, direction, paging]);

  const visible = paging ? sorted : expanded ? sorted : sorted.slice(0, maxRows);
  const hiddenCount = paging ? 0 : sorted.length - visible.length;

  const activeSort = paging ? paging.sort : sortKey;
  const activeDir = paging ? paging.dir : direction;

  const toggle = (key: string): void => {
    if (paging) {
      paging.onSort(key);
      return;
    }
    if (key === sortKey) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDirection("desc");
    }
  };

  // Scale the scroll floor with column count so a wide table scrolls rather
  // than crushing ten columns into one screen width.
  const minWidth = Math.max(600, columns.length * 104);

  const rangeStart = paging ? Math.min(paging.offset + 1, paging.total) : 0;
  const rangeEnd = paging ? Math.min(paging.offset + rows.length, paging.total) : 0;

  return (
    <div>
      {paging && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border border-xyne-border bg-xyne-surface-sunken px-2.5 py-1.5">
            <Search size={13} className="shrink-0 text-xyne-fg-muted" aria-hidden />
            <input
              value={paging.search}
              onChange={(e) => paging.onSearch(e.target.value)}
              placeholder={paging.searchPlaceholder ?? "Filter by name…"}
              className="w-[200px] bg-transparent text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:outline-none"
            />
            {paging.search && (
              <button
                type="button"
                onClick={() => paging.onSearch("")}
                aria-label="Clear filter"
                className="text-xyne-fg-muted hover:text-xyne-fg-primary"
              >
                <X size={12} aria-hidden />
              </button>
            )}
          </div>
          <span className="text-[12px] tabular-nums text-xyne-fg-muted">
            {paging.total === 0
              ? `No ${paging.unit}`
              : `${rangeStart}–${rangeEnd} of ${paging.total.toLocaleString()} ${paging.unit}`}
            {paging.search && " matching"}
          </span>
        </div>
      )}
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full border-collapse text-left" style={{ minWidth }}>
          <thead>
            <tr className="border-b border-xyne-border">
              {columns.map((col) => (
                <th key={col.key} className={cn(th, col.numeric && "text-right")}>
                  {col.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggle(col.key)}
                      title={col.hint ?? `Sort by ${col.header}`}
                      className={cn(
                        "inline-flex items-center gap-1 uppercase tracking-wider hover:text-xyne-fg-primary",
                        col.numeric && "flex-row-reverse",
                        activeSort === col.key && "text-xyne-fg-primary",
                      )}
                    >
                      {col.header}
                      {activeSort === col.key &&
                        (activeDir === "asc" ? (
                          <ArrowUp size={12} aria-hidden />
                        ) : (
                          <ArrowDown size={12} aria-hidden />
                        ))}
                    </button>
                  ) : (
                    <span title={col.hint}>{col.header}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td className="py-6 text-[13px] text-xyne-fg-muted" colSpan={columns.length}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={rowKey(row)} className="border-t border-xyne-border-subtle">
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(td, col.numeric && "text-right tabular-nums")}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {paging && paging.total > paging.limit && (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={paging.offset === 0}
            onClick={() => paging.onOffset(Math.max(0, paging.offset - paging.limit))}
            className="rounded-md border border-xyne-border px-2.5 py-1 text-[12px] font-medium text-xyne-fg-primary disabled:cursor-not-allowed disabled:opacity-40 hover:enabled:bg-xyne-surface-sunken"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={paging.offset + paging.limit >= paging.total}
            onClick={() => paging.onOffset(paging.offset + paging.limit)}
            className="rounded-md border border-xyne-border px-2.5 py-1 text-[12px] font-medium text-xyne-fg-primary disabled:cursor-not-allowed disabled:opacity-40 hover:enabled:bg-xyne-surface-sunken"
          >
            Next
          </button>
          <span className="text-[12px] tabular-nums text-xyne-fg-muted">
            Page {Math.floor(paging.offset / paging.limit) + 1} of{" "}
            {Math.max(1, Math.ceil(paging.total / paging.limit))}
          </span>
        </div>
      )}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-3 text-[12px] font-medium text-xyne-fg-muted hover:text-xyne-fg-primary"
        >
          Show {hiddenCount} more
        </button>
      )}
      {expanded && sorted.length > maxRows && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-3 text-[12px] font-medium text-xyne-fg-muted hover:text-xyne-fg-primary"
        >
          Show less
        </button>
      )}
    </div>
  );
}

/* ── Panel states ─────────────────────────────────────────────────────────── */

export function PanelMessage({
  title,
  detail,
}: {
  title: string;
  detail?: string;
}): ReactElement {
  return (
    <div className="rounded-xl border border-dashed border-xyne-border px-5 py-10 text-center">
      <p className="text-[13px] font-medium text-xyne-fg-primary">{title}</p>
      {detail && <p className="mt-1 text-[12px] text-xyne-fg-muted">{detail}</p>}
    </div>
  );
}

export function PanelError({ error }: { error: string }): ReactElement {
  return (
    <div className="rounded-xl border border-xyne-error-border bg-xyne-error-bg px-4 py-3 text-[13px] text-xyne-error-fg">
      Failed to load: {error}
    </div>
  );
}
