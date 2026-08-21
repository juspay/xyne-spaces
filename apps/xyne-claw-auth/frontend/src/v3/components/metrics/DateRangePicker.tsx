/**
 * Window control: presets, a single exact date, or a custom range.
 *
 * The presets stay because they answer the common question in one click. The
 * date inputs exist for the two things a preset cannot express — "what happened
 * on the 14th" and "the fortnight either side of the deploy".
 *
 * ── Timezone ──────────────────────────────────────────────────────────────
 * `<input type="date">` yields a bare calendar date with no zone. Sending that
 * verbatim would mean UTC on the server, so a user in IST asking for "the 14th"
 * would get 05:30 on the 14th to 05:30 on the 15th. These are converted to the
 * VIEWER's local day boundaries and sent as ISO instants, so the range means
 * the day the person actually had.
 */

import { useEffect, useRef, useState, type ReactElement } from "react";
import { CalendarDays, ChevronDown, X } from "lucide-react";
import { cn } from "../../../lib/utils";

export type MetricsDays = 1 | 7 | 30;

export interface WindowSelection {
  /** Preset length, used when `from`/`to` are absent. */
  days: MetricsDays;
  /** ISO instant at the start of the local day. */
  from?: string | undefined;
  /** ISO instant at the end of the local day. */
  to?: string | undefined;
}

const PRESETS: Array<{ label: string; days: MetricsDays }> = [
  { label: "1d", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
];

/** Local midnight at the start of `yyyy-mm-dd`, as an ISO instant. */
function localDayStart(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0).toISOString();
}

/** The last millisecond of `yyyy-mm-dd`, locally, as an ISO instant. */
function localDayEnd(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999).toISOString();
}

/** ISO instant → the `yyyy-mm-dd` the date input should show, in local time. */
function toInputDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const fmt = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function summarise(value: WindowSelection): string {
  if (!value.from && !value.to) {
    return PRESETS.find((p) => p.days === value.days)?.label ?? `${value.days}d`;
  }
  const from = value.from ? fmt(value.from) : null;
  const to = value.to ? fmt(value.to) : null;
  if (from && to) return from === to ? from : `${from} – ${to}`;
  if (from) return `since ${from}`;
  return `until ${to}`;
}

export function DateRangePicker({
  value,
  onChange,
}: {
  value: WindowSelection;
  onChange: (next: WindowSelection) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const custom = Boolean(value.from || value.to);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const fromDate = toInputDate(value.from);
  const toDate = toInputDate(value.to);
  // A date after today would select an empty future window.
  const today = toInputDate(new Date().toISOString());

  const setExact = (date: string): void => {
    if (!date) onChange({ days: value.days });
    else onChange({ days: value.days, from: localDayStart(date), to: localDayEnd(date) });
  };

  return (
    <div ref={rootRef} className="relative flex items-center gap-1 rounded-full bg-xyne-surface-sunken p-1">
      {PRESETS.map((preset) => (
        <button
          key={preset.days}
          type="button"
          onClick={() => onChange({ days: preset.days })}
          className={cn(
            "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
            !custom && value.days === preset.days
              ? "bg-xyne-fg-primary text-xyne-fg-inverse"
              : "text-xyne-fg-muted hover:text-xyne-fg-primary",
          )}
        >
          {preset.label}
        </button>
      ))}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
          custom
            ? "bg-xyne-fg-primary text-xyne-fg-inverse"
            : "text-xyne-fg-muted hover:text-xyne-fg-primary",
        )}
      >
        <CalendarDays size={12} aria-hidden />
        {custom ? summarise(value) : "Dates"}
        {custom ? (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear date range"
            onClick={(e) => {
              e.stopPropagation();
              onChange({ days: value.days });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                e.preventDefault();
                onChange({ days: value.days });
              }
            }}
          >
            <X size={11} aria-hidden />
          </span>
        ) : (
          <ChevronDown size={11} aria-hidden />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose dates"
          className="absolute right-0 top-full z-30 mt-2 w-[290px] rounded-lg border border-xyne-border bg-xyne-surface p-3 shadow-lg"
        >
          <label className="block text-[11px] font-medium uppercase tracking-wider text-xyne-fg-muted">
            Exact date
          </label>
          <input
            type="date"
            max={today}
            value={fromDate && fromDate === toDate ? fromDate : ""}
            onChange={(e) => setExact(e.target.value)}
            className="mt-1 w-full rounded-md border border-xyne-border bg-xyne-surface-sunken px-2 py-1.5 text-[13px] text-xyne-fg-primary focus:outline-none focus:ring-1 focus:ring-xyne-border-focus"
          />

          <div className="my-3 border-t border-xyne-border-subtle" />

          <label className="block text-[11px] font-medium uppercase tracking-wider text-xyne-fg-muted">
            Range
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="date"
              max={toDate || today}
              value={fromDate}
              onChange={(e) =>
                onChange({
                  days: value.days,
                  ...(e.target.value ? { from: localDayStart(e.target.value) } : {}),
                  ...(value.to ? { to: value.to } : {}),
                })
              }
              className="min-w-0 flex-1 rounded-md border border-xyne-border bg-xyne-surface-sunken px-2 py-1.5 text-[13px] text-xyne-fg-primary focus:outline-none focus:ring-1 focus:ring-xyne-border-focus"
            />
            <span className="shrink-0 text-[12px] text-xyne-fg-muted">to</span>
            <input
              type="date"
              min={fromDate}
              max={today}
              value={toDate}
              onChange={(e) =>
                onChange({
                  days: value.days,
                  ...(value.from ? { from: value.from } : {}),
                  ...(e.target.value ? { to: localDayEnd(e.target.value) } : {}),
                })
              }
              className="min-w-0 flex-1 rounded-md border border-xyne-border bg-xyne-surface-sunken px-2 py-1.5 text-[13px] text-xyne-fg-primary focus:outline-none focus:ring-1 focus:ring-xyne-border-focus"
            />
          </div>

          <p className="mt-2 text-[11px] text-xyne-fg-muted">
            Whole days in your local timezone. One date selects that day; leaving an end empty runs
            to now.
          </p>

          {custom && (
            <button
              type="button"
              onClick={() => {
                onChange({ days: value.days });
                setOpen(false);
              }}
              className="mt-3 text-[12px] font-medium text-xyne-fg-muted hover:text-xyne-fg-primary"
            >
              Back to presets
            </button>
          )}
        </div>
      )}
    </div>
  );
}
