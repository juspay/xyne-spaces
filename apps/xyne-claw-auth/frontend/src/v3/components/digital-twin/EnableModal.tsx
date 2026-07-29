import { useState, useEffect, useCallback } from "react";
import {
  BrainIcon,
  SpinnerGapIcon,
  CheckIcon,
  ArrowRightIcon,
  ChartBarIcon,
} from "@phosphor-icons/react";
import { getDigitalTwinEstimate, enableDigitalTwin } from "../../../lib/api";
import type { DigitalTwinEstimate } from "../../../lib/api";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";

interface EnableModalProps {
  userId: string;
  open: boolean;
  mode: "enable" | "backfill";
  onClose: () => void;
  onEnabled: () => void;
}

interface RangePreset {
  label: string;
  sublabel?: string;
  months: number | null;
}

const PRESETS_ENABLE: RangePreset[] = [
  { label: "Skip backfill", sublabel: "Start learning from today only", months: null },
  { label: "Last 3 months",  sublabel: "Light — recent context",         months: 3  },
  { label: "Last 6 months",  sublabel: "Recommended — solid coverage",   months: 6  },
  { label: "Last 12 months", sublabel: "Deep — full year of history",    months: 12 },
];

const PRESETS_BACKFILL: RangePreset[] = [
  { label: "Last 3 months",  sublabel: "Recent context only",  months: 3  },
  { label: "Last 6 months",  sublabel: "Solid coverage",       months: 6  },
  { label: "Last 12 months", sublabel: "Full year of history", months: 12 },
  { label: "Last 24 months", sublabel: "Maximum depth",        months: 24 },
];

/** Quick-pick day offsets shown inside the custom range card */
const QUICK_DAYS = [7, 14, 30, 60, 90];

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export function EnableModal({ userId, open, mode, onClose, onEnabled }: EnableModalProps) {
  const presets = mode === "enable" ? PRESETS_ENABLE : PRESETS_BACKFILL;

  // "preset" mode: one of the preset cards is selected
  // "custom" mode: the custom-range card is selected, dates editable
  const [selection,  setSelection]  = useState<"preset" | "custom">("preset");
  const [presetIdx,  setPresetIdx]  = useState(mode === "enable" ? 2 : 1);

  // Custom range — default to last 7 days
  const [customFrom, setCustomFrom] = useState(() => daysAgo(7));
  const [customTo,   setCustomTo]   = useState(() => isoDate(new Date()));

  const [estimate,   setEstimate]   = useState<DigitalTwinEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [enabling,   setEnabling]   = useState(false);
  const [err,        setErr]        = useState<string | null>(null);

  /** Resolve the currently-selected date range, or null if "skip backfill". */
  const resolveRange = useCallback((): { from: string; to: string } | null => {
    if (selection === "custom") {
      if (!customFrom || !customTo || customFrom > customTo) return null;
      return { from: customFrom, to: customTo };
    }
    const preset = presets[presetIdx];
    if (!preset || preset.months === null) return null;
    const to   = new Date();
    const from = new Date(to);
    from.setMonth(from.getMonth() - preset.months);
    return { from: isoDate(from), to: isoDate(to) };
  }, [selection, presetIdx, presets, customFrom, customTo]);

  // Fetch estimate whenever the selection changes
  useEffect(() => {
    const range = resolveRange();
    if (!range) { setEstimate(null); return; }
    setEstimating(true);
    setErr(null);
    getDigitalTwinEstimate(userId, range.from, range.to)
      .then(setEstimate)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setEstimating(false));
  }, [selection, presetIdx, customFrom, customTo, userId, resolveRange]);

  async function submit() {
    setEnabling(true);
    setErr(null);
    try {
      await enableDigitalTwin(userId, resolveRange());
      onEnabled();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setEnabling(false);
    }
  }

  /** Apply a quick-chip offset (days) inside the custom card */
  function applyQuickDays(n: number) {
    setCustomFrom(daysAgo(n));
    setCustomTo(isoDate(new Date()));
  }

  const ctaLabel = enabling
    ? (mode === "enable" ? "Enabling…" : "Starting…")
    : (mode === "enable" ? "Enable & Start" : "Start backfill");

  const customDays = daysBetween(customFrom, customTo);

  return (
    <Dialog
      open={open}
      onOpenChange={(newOpen) => { if (!newOpen) onClose(); }}
      title={mode === "enable" ? "Enable Digital Twin" : "Backfill history"}
      maxWidth={500}
      leftOffset={100}
      footer={
        <div className="flex w-full items-center justify-between">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={enabling}>
            Cancel
          </Button>
          <button
            onClick={submit}
            disabled={enabling}
            className="flex items-center gap-[8px] rounded-full bg-xyne-fg-primary px-[20px] py-[10px] text-[13px] font-semibold text-xyne-fg-inverse shadow-sm transition hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
          >
            {enabling && <SpinnerGapIcon size={13} className="animate-spin" />}
            {ctaLabel}
            {!enabling && (
              <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-xyne-fg-inverse/20">
                <ArrowRightIcon size={12} className="text-xyne-fg-inverse" />
              </span>
            )}
          </button>
        </div>
      }
    >
      {/* ── Branded header ── */}
      <div className="flex items-center gap-[14px] rounded-xl p-[14px] bg-[linear-gradient(135deg,_#f3f0ff_0%,_#eff4ff_100%)] dark:bg-[linear-gradient(135deg,_#1f1d3a_0%,_#1b2335_100%)]">
        <div
          className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full"
          style={{
            background: "radial-gradient(circle at 38% 32%, #ffffff 0%, #ede9ff 60%, #ddd6fe 100%)",
            boxShadow: "0 2px 12px rgba(109,40,217,0.14)",
            border: "1px solid rgba(139,92,246,0.2)",
          }}
        >
          <BrainIcon size={22} className="text-xyne-brand" />
        </div>
        <p className="text-[12px] leading-[1.6] text-xyne-fg-secondary">
          {mode === "enable"
            ? "Your Twin learns from your public Spaces activity — messages you sent, calls you hosted, canvases you authored. Nothing in DMs or private channels is read."
            : "Run another pass over your Spaces history. Adds candidate memories to your review queue."}
        </p>
      </div>

      {/* ── Range selector ── */}
      <div className="flex flex-col gap-[6px]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-xyne-fg-tertiary">
          How far back to look
        </p>
        <div className="flex flex-col gap-[6px]">

          {/* Preset cards */}
          {presets.map((preset, i) => {
            const isSelected = selection === "preset" && presetIdx === i;
            return (
              <button
                key={i}
                type="button"
                onClick={() => { setSelection("preset"); setPresetIdx(i); }}
                className={`flex w-full items-center gap-[12px] rounded-xl border px-[14px] py-[12px] text-left transition ${
                  isSelected
                    ? "border-xyne-brand bg-xyne-brand/5 shadow-sm"
                    : "border-xyne-border bg-xyne-surface hover:border-xyne-brand/40 hover:bg-xyne-surface-sunken"
                }`}
              >
                {/* Radio indicator */}
                <span
                  className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 transition ${
                    isSelected ? "border-xyne-brand" : "border-xyne-border"
                  }`}
                >
                  {isSelected && <span className="h-[8px] w-[8px] rounded-full bg-xyne-brand" />}
                </span>
                <span className="flex-1">
                  <span className="block text-[13px] font-medium text-xyne-fg-primary">
                    {preset.label}
                  </span>
                  {preset.sublabel && (
                    <span className="block text-[11px] text-xyne-fg-tertiary">{preset.sublabel}</span>
                  )}
                </span>
                {isSelected && <CheckIcon size={14} className="shrink-0 text-xyne-brand" />}
              </button>
            );
          })}

          {/* Custom range card */}
          <div
            className={`rounded-xl border transition ${
              selection === "custom"
                ? "border-xyne-brand bg-xyne-brand/5 shadow-sm"
                : "border-xyne-border bg-xyne-surface hover:border-xyne-brand/40 hover:bg-xyne-surface-sunken"
            }`}
          >
            {/* Header row — clicking selects custom */}
            <button
              type="button"
              onClick={() => setSelection("custom")}
              className="flex w-full items-center gap-[12px] px-[14px] py-[12px] text-left"
            >
              <span
                className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 transition ${
                  selection === "custom" ? "border-xyne-brand" : "border-xyne-border"
                }`}
              >
                {selection === "custom" && <span className="h-[8px] w-[8px] rounded-full bg-xyne-brand" />}
              </span>
              <span className="flex-1">
                <span className="block text-[13px] font-medium text-xyne-fg-primary">Custom range</span>
                {selection !== "custom" && (
                  <span className="block text-[11px] text-xyne-fg-tertiary">Pick exact dates</span>
                )}
              </span>
              {selection === "custom" && <CheckIcon size={14} className="shrink-0 text-xyne-brand" />}
            </button>

            {/* Expanded date inputs — only when custom is selected */}
            {selection === "custom" && (
              <div className="border-t border-xyne-brand/20 px-[14px] pb-[12px] pt-[10px]">
                {/* Date row */}
                <div className="flex items-center gap-[8px]">
                  <input
                    type="date"
                    value={customFrom}
                    max={customTo}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="flex-1 rounded-lg border border-xyne-border bg-xyne-surface px-[10px] py-[6px] text-[12px] text-xyne-fg-primary focus:border-xyne-brand focus:outline-none"
                  />
                  <span className="shrink-0 text-[11px] text-xyne-fg-tertiary">→</span>
                  <input
                    type="date"
                    value={customTo}
                    min={customFrom}
                    max={isoDate(new Date())}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="flex-1 rounded-lg border border-xyne-border bg-xyne-surface px-[10px] py-[6px] text-[12px] text-xyne-fg-primary focus:border-xyne-brand focus:outline-none"
                  />
                  {customDays > 0 && (
                    <span className="shrink-0 text-[11px] tabular-nums text-xyne-fg-muted">
                      {customDays}d
                    </span>
                  )}
                </div>

                {/* Quick-pick chips */}
                <div className="mt-[8px] flex flex-wrap gap-[6px]">
                  {QUICK_DAYS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => applyQuickDays(n)}
                      className="rounded-lg border border-xyne-border bg-xyne-surface px-[10px] py-[3px] text-[11px] text-xyne-fg-secondary transition hover:border-xyne-brand/50 hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
                    >
                      last {n}d
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* ── Estimate ── */}
      {estimating && (
        <div className="flex items-center gap-[6px] text-[11px] text-xyne-fg-muted">
          <SpinnerGapIcon size={12} className="animate-spin" />
          Estimating…
        </div>
      )}

      {estimate && !estimating && (
        <div className="overflow-hidden rounded-xl border border-xyne-border bg-xyne-surface-sunken">
          <div className="flex items-center gap-[6px] border-b border-xyne-border px-[14px] py-[8px]">
            <ChartBarIcon size={13} className="text-xyne-fg-tertiary" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-xyne-fg-tertiary">
              Estimated scope
            </span>
          </div>
          <div className="grid grid-cols-3 divide-x divide-xyne-border">
            {[
              { label: "Messages", value: estimate.messages },
              { label: "Calls",    value: estimate.calls    },
              { label: "Canvases", value: estimate.canvases },
            ].map(({ label, value }) => (
              <div key={label} className="flex flex-col items-center gap-[2px] px-[12px] py-[10px]">
                <span className="text-[16px] font-semibold tabular-nums text-xyne-fg-primary">
                  {(value ?? 0).toLocaleString()}
                </span>
                <span className="text-[10px] text-xyne-fg-tertiary">{label}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-xyne-border px-[14px] py-[8px] text-[11px] text-xyne-fg-tertiary">
            ~{estimate.estCandidates ?? 0} candidate memor{(estimate.estCandidates ?? 0) === 1 ? "y" : "ies"}
            {" · "}~${(estimate.estCostUSD ?? 0).toFixed(2)} LLM cost (charged to org)
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {err && (
        <div className="rounded-lg border border-xyne-border bg-xyne-error-bg p-[10px] text-[11px] text-xyne-error-fg">
          {err}
        </div>
      )}
    </Dialog>
  );
}
