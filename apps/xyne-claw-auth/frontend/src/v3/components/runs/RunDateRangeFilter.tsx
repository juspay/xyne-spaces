import {
  RUN_RANGE_PRESETS,
  RUN_CUSTOM_RANGE_MAX_DAYS,
  dateInputValue,
  shiftDateInputValue,
  type RunRangePreset,
} from "../../lib/runFormat";

interface Props {
  preset: RunRangePreset;
  customFrom: string;
  customTo: string;
  onChange: (next: { preset: RunRangePreset; customFrom: string; customTo: string }) => void;
}

/**
 * Date-window control for the run listings: the same pill group the metrics
 * page uses, plus a "Custom" pill that reveals two native date inputs.
 *
 * Native `<input type="date">` rather than a component: there is no date picker
 * in v3's ui/ kit, and the two other v3 pages with a custom window
 * (DigitalTwinReplyActivity, DigitalTwinMemories) already use the native input.
 * Adding a picker here would make this the only page that looks different.
 */
export function RunDateRangeFilter({ preset, customFrom, customTo, onChange }: Props) {
  // Span bounds, not just the cross-bounds below: `to - from` over the server's
  // window cap is rejected on every keystroke-triggered refetch, and on the
  // Activity tab that 400 is the only feedback the user gets. Bounding the
  // inputs means the pair the control can produce is always one the endpoint
  // accepts. Both sides go through dateInputValue so they stay in the viewer's
  // local calendar, matching what the inputs themselves display.
  const today = dateInputValue(new Date());
  const fromMin = customTo ? shiftDateInputValue(customTo, -RUN_CUSTOM_RANGE_MAX_DAYS) : null;
  const fromSpanCap = customFrom ? shiftDateInputValue(customFrom, RUN_CUSTOM_RANGE_MAX_DAYS) : null;
  // A future `to` is never useful here — runs can't have started after now.
  const toMax = fromSpanCap && fromSpanCap < today ? fromSpanCap : today;
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 rounded-full bg-xyne-bg-secondary p-1">
        {RUN_RANGE_PRESETS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => onChange({ preset: opt.id, customFrom, customTo })}
            className={
              "px-3 py-1 rounded-full text-[12px] font-medium transition-colors " +
              (preset === opt.id
                ? "bg-xyne-fg-primary text-xyne-fg-inverse"
                : "text-xyne-fg-muted hover:text-xyne-fg-primary")
            }
          >
            {opt.label}
          </button>
        ))}
        <button
          onClick={() => onChange({ preset: "custom", customFrom, customTo })}
          className={
            "px-3 py-1 rounded-full text-[12px] font-medium transition-colors " +
            (preset === "custom"
              ? "bg-xyne-fg-primary text-xyne-fg-inverse"
              : "text-xyne-fg-muted hover:text-xyne-fg-primary")
          }
        >
          Custom
        </button>
      </div>

      {preset === "custom" && (
        <div className="flex items-center gap-2">
          {/* Cross-bounded so the two inputs can't be dragged into an inverted
              range the server would 400 on (`to <= from`), and span-bounded so
              they can't be dragged into an over-long one either. */}
          <input
            type="date"
            value={customFrom}
            min={fromMin || undefined}
            max={customTo || today}
            onChange={(e) => onChange({ preset, customFrom: e.target.value, customTo })}
            className="rounded-md border border-xyne-border bg-xyne-surface px-[6px] py-[3px] text-[12px] text-xyne-fg-primary"
          />
          <span className="text-[12px] text-xyne-fg-muted">→</span>
          <input
            type="date"
            value={customTo}
            min={customFrom || undefined}
            max={toMax}
            onChange={(e) => onChange({ preset, customFrom, customTo: e.target.value })}
            className="rounded-md border border-xyne-border bg-xyne-surface px-[6px] py-[3px] text-[12px] text-xyne-fg-primary"
          />
        </div>
      )}
    </div>
  );
}
