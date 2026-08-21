/**
 * Checkbox dropdown for the metrics filter bar.
 *
 * Built rather than reused because the page's existing `<select>` is
 * single-value and the v3 kit has no multi-select. Three things it has to get
 * right, all of which a naive popover gets wrong:
 *
 *   - EMPTY MEANS ALL. The trigger says "All agents", never "0 selected" — an
 *     unfiltered view is the default, not an empty one.
 *   - The search box filters the option list only. Clearing it must not clear
 *     the selection, so selected-but-filtered-out options stay selected and the
 *     count in the trigger keeps reflecting the true selection.
 *   - Options can arrive after the URL already names a selection (the roster
 *     loads async), so a selected value absent from `options` is still rendered
 *     and still counted rather than silently dropped.
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "../../../lib/utils";

export function MultiSelect({
  label,
  allLabel,
  options,
  selected,
  onChange,
  emptyMessage = "Nothing to choose from yet.",
  searchPlaceholder = "Search…",
  className,
}: {
  label: string;
  /** Trigger text when nothing is selected — states that the view is unfiltered. */
  allLabel: string;
  options: readonly string[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  emptyMessage?: string;
  searchPlaceholder?: string;
  className?: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // A selection made before the roster loaded (or pointing at a deleted entity)
  // still belongs in the list — dropping it would silently discard the filter.
  const allOptions = useMemo(() => {
    const known = new Set(options);
    const orphans = selected.filter((s) => !known.has(s));
    return [...orphans, ...options];
  }, [options, selected]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? allOptions.filter((o) => o.toLowerCase().includes(q)) : allOptions;
  }, [allOptions, query]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggle = (value: string): void => {
    const next = selectedSet.has(value)
      ? selected.filter((s) => s !== value)
      : [...selected, value];
    onChange(next);
  };

  const triggerText =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? selected[0]!
        : `${selected.length} ${label.toLowerCase()}`;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex h-[32px] max-w-[240px] items-center gap-1.5 rounded-md border border-xyne-border bg-xyne-surface-sunken px-3 text-[13px] text-xyne-fg-primary",
          "hover:border-xyne-border-strong focus:outline-none focus:ring-1 focus:ring-xyne-border-focus",
        )}
      >
        <span className="truncate">{triggerText}</span>
        {selected.length > 0 && (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Clear ${label} filter`}
            onClick={(e) => {
              e.stopPropagation();
              onChange([]);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                e.preventDefault();
                onChange([]);
              }
            }}
            className="shrink-0 rounded-sm text-xyne-fg-muted hover:text-xyne-fg-primary"
          >
            <X size={12} aria-hidden />
          </span>
        )}
        <ChevronDown size={13} className="shrink-0 text-xyne-fg-muted" aria-hidden />
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-1 w-[280px] rounded-lg border border-xyne-border bg-xyne-surface p-1 shadow-lg">
          <div className="flex items-center gap-2 border-b border-xyne-border-subtle px-2 pb-1.5 pt-1">
            <Search size={13} className="shrink-0 text-xyne-fg-muted" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder focus:outline-none"
            />
          </div>

          <div className="max-h-[260px] overflow-y-auto py-1">
            {visible.length === 0 ? (
              <p className="px-3 py-4 text-center text-[12px] text-xyne-fg-muted">
                {query ? "No match." : emptyMessage}
              </p>
            ) : (
              visible.map((option) => {
                const isSelected = selectedSet.has(option);
                return (
                  <button
                    key={option}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => toggle(option)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-xyne-fg-primary hover:bg-xyne-surface-sunken"
                  >
                    <span
                      className={cn(
                        "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                        isSelected
                          ? "border-xyne-brand bg-xyne-brand text-xyne-fg-inverse"
                          : "border-xyne-border-strong",
                      )}
                    >
                      {isSelected && <Check size={10} aria-hidden />}
                    </span>
                    <span className="truncate font-mono text-[12px]">{option}</span>
                  </button>
                );
              })
            )}
          </div>

          {selected.length > 0 && (
            <div className="flex items-center justify-between border-t border-xyne-border-subtle px-2 pt-1.5">
              <span className="text-[11px] text-xyne-fg-muted">{selected.length} selected</span>
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-[11px] font-medium text-xyne-fg-muted hover:text-xyne-fg-primary"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
