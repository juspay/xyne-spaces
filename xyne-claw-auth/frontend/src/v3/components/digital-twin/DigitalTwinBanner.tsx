import {
  CheckCircleIcon,
  WarningCircleIcon,
  SpinnerGapIcon,
  WarningIcon,
  BrainIcon,
} from "@phosphor-icons/react";
import { Button } from "../ui/Button";
import { InfoIcon } from "../ui/Tooltip";
import type { DigitalTwinStatus } from "../../../lib/api";

const TOOLTIPS = {
  label:
    "Your personal AI. When someone mentions you, the Twin drafts a reply on your behalf, grounded in memories you approved. Every memory passes through your review queue first.",
  disable:
    "Pause the Twin (no more recall, no nightly curation). Optionally delete every memory at the same time. You can re-enable later.",
} as const;

interface DigitalTwinBannerProps {
  status: DigitalTwinStatus | null;
  loading: boolean;
  /** True when the backfill has been polling for ~30s with no cursor movement. */
  backfillStalled?: boolean;
  onEnable: () => void;
  /** Used only for the stalled-backfill "Disable & retry" CTA. */
  onDisable: () => void;
}

export function DigitalTwinBanner({
  status,
  loading,
  backfillStalled = false,
  onEnable,
  onDisable,
}: DigitalTwinBannerProps) {
  if (loading || !status) {
    return (
      <div className="rounded-xl border border-xyne-border bg-xyne-surface p-[16px]">
        <div className="flex items-center gap-[8px]">
          <SpinnerGapIcon size={16} className="animate-spin text-xyne-fg-muted" />
          <span className="text-[13px] text-xyne-fg-muted">Loading Digital Twin…</span>
        </div>
      </div>
    );
  }

  const backfillRunning = status.backfillState
    ? Object.values(status.backfillState).some((s) => !s.complete)
    : false;

  // ── State: Off ──────────────────────────────────────────────────────
  if (!status.enabled) {
    return (
      <div className="overflow-hidden rounded-xl border border-xyne-success-fg/30 bg-xyne-surface">
        {/* Subtle green top accent */}
        <div className="h-[2px] w-full bg-xyne-success-fg opacity-40" />
        <div className="p-[16px]">
          <div className="flex items-start gap-[10px]">
            <BrainIcon size={18} weight="duotone" className="mt-[1px] shrink-0 text-xyne-success-fg opacity-60" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-[6px]">
                <p className="text-[13px] font-semibold text-xyne-fg-primary">Digital Twin</p>
                <InfoIcon text={TOOLTIPS.label} />
              </div>
              <p className="mt-[3px] text-[11px] leading-relaxed text-xyne-fg-tertiary">
                Learns from your Spaces history — every memory passes your review before it's saved.
              </p>
            </div>
          </div>
          <button
            onClick={onEnable}
            className="mt-[14px] flex w-full items-center justify-center gap-[8px] rounded-lg bg-xyne-success-fg px-[14px] py-[9px] text-[13px] font-semibold text-white transition hover:opacity-90 active:opacity-80"
          >
            <BrainIcon size={15} weight="duotone" />
            Enable Digital Twin
          </button>
        </div>
      </div>
    );
  }

  // ── State: Backfilling ──────────────────────────────────────────────
  if (backfillRunning) {
    // Overall progress: average pct across all sources.
    const entries    = Object.values(status.backfillState!);
    const overallPct = Math.round(
      entries.reduce((sum, e) => {
        if (e.complete) return sum + 100;
        const total   = new Date(e.to).getTime() - new Date(e.from).getTime();
        const elapsed = new Date(e.to).getTime() - new Date(e.cursor).getTime();
        return sum + (total > 0 ? Math.min(100, Math.round((elapsed / total) * 100)) : 100);
      }, 0) / (entries.length || 1),
    );

    return (
      <div className="rounded-xl border border-xyne-border bg-xyne-surface overflow-hidden">
        <style>{`@keyframes dt-slide { 0%{transform:translateX(-130%)} 100%{transform:translateX(400%)} }`}</style>

        {/* ── Top accent bar ── */}
        {backfillStalled ? (
          <div className="h-[2px] w-full bg-xyne-fg-primary" />
        ) : (
          <div className="h-[2px] w-full overflow-hidden bg-xyne-border">
            <div
              className="h-full w-[38%] rounded-full bg-xyne-fg-primary opacity-50"
              style={{ animation: "dt-slide 2.2s cubic-bezier(0.4,0,0.6,1) infinite" }}
            />
          </div>
        )}

        {/* ── Stalled alert ── */}
        {backfillStalled && (
          <div className="flex flex-wrap items-center justify-between gap-[10px] border-b border-xyne-border bg-xyne-surface-sunken px-[14px] py-[10px]">
            <div className="flex items-center gap-[8px]">
              <WarningIcon size={14} className="shrink-0 text-xyne-fg-primary" weight="bold" />
              <span className="text-[12px] font-semibold text-xyne-fg-primary">Backfill stalled</span>
              <span className="text-[11px] text-xyne-fg-secondary">No progress in 30 s</span>
            </div>
            <button
              onClick={onDisable}
              className="rounded-lg border border-xyne-border bg-xyne-surface px-[10px] py-[4px] text-[11px] font-semibold text-xyne-fg-primary transition hover:bg-xyne-surface-sunken"
            >
              Disable &amp; retry
            </button>
          </div>
        )}

        {/* ── Status row ── */}
        <div className="flex items-center gap-[8px] border-b border-xyne-border px-[14px] py-[10px]">
          {backfillStalled
            ? <WarningCircleIcon size={14} className="shrink-0 text-xyne-fg-muted" />
            : <SpinnerGapIcon size={14} className="animate-spin shrink-0 text-xyne-fg-muted" />
          }
          <span className="text-[12px] font-medium text-xyne-fg-primary">
            Backfilling your history
          </span>
          <span className="text-[11px] tabular-nums text-xyne-fg-muted">{overallPct}%</span>
        </div>

        {/* ── Per-source compact cards ── */}
        <div
          className="grid gap-[1px] bg-xyne-border"
          style={{ gridTemplateColumns: `repeat(${Object.keys(status.backfillState!).length}, 1fr)` }}
        >
          {Object.entries(status.backfillState!).map(([source, entry]) => {
            const to      = new Date(entry.to);
            const from    = new Date(entry.from);
            const cursor  = new Date(entry.cursor);
            const total   = to.getTime() - from.getTime();
            const elapsed = to.getTime() - cursor.getTime();
            const pct     = total > 0 ? Math.min(100, Math.max(0, Math.round((elapsed / total) * 100))) : 100;
            const isStuck = backfillStalled && !entry.complete;
            const fillWidth  = entry.complete ? 100 : isStuck ? Math.max(pct, 4) : pct;
            const barOpacity = entry.complete ? "opacity-100" : isStuck ? "opacity-30" : pct > 0 ? "opacity-60" : "opacity-0";

            const badgeLabel = entry.complete ? "Done ✓" : isStuck ? "Stalled" : pct > 0 ? `${pct}%` : "Queued";
            const badgeCls   = entry.complete
              ? "bg-xyne-success-fg text-white"
              : isStuck
              ? "border border-xyne-warning-fg/50 bg-xyne-warning-fg/10 text-xyne-warning-fg"
              : pct > 0
              ? "bg-xyne-fg-primary/15 text-xyne-fg-primary"
              : "bg-xyne-border text-xyne-fg-muted";

            const cursorLabel = (() => {
              try { return new Date(entry.cursor).toLocaleDateString("en-US", { month: "short", year: "numeric" }); }
              catch { return null; }
            })();

            return (
              <div key={source} className="flex flex-col gap-[8px] bg-xyne-surface p-[12px]">
                {/* Label + badge */}
                <div className="flex items-center justify-between gap-[6px]">
                  <span className="text-[11px] font-semibold capitalize text-xyne-fg-primary">{source}</span>
                  {entry.complete ? (
                    <CheckCircleIcon size={16} weight="duotone" className="text-xyne-success-fg" />
                  ) : (
                    <span className={`rounded-full px-[7px] py-[1px] text-[10px] font-medium ${badgeCls}`}>
                      {badgeLabel}
                    </span>
                  )}
                </div>
                {/* Progress bar — thin */}
                <div className="h-[3px] overflow-hidden rounded-full bg-xyne-border">
                  <div
                    className={`h-full rounded-full bg-xyne-fg-primary transition-all duration-700 ${barOpacity}`}
                    style={{ width: `${fillWidth}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

      </div>
    );
  }

  // ── State: Active ───────────────────────────────────────────────────
  const hasPending = status.pendingCandidates > 0;

  return (
    <div className="rounded-xl border border-xyne-border bg-xyne-surface overflow-hidden">
      {/* Thin success accent */}
      <div className="h-[2px] w-full bg-xyne-success-fg opacity-50" />

      <div className="flex items-start gap-[10px] px-[16px] py-[14px]">
        <CheckCircleIcon size={18} className="mt-[1px] shrink-0 text-xyne-success-fg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-[6px] text-[13px] font-semibold text-xyne-fg-primary">
            Digital Twin is active
            <InfoIcon text={TOOLTIPS.label} />
          </div>
          <div className="mt-[2px] flex flex-wrap items-center gap-x-[8px] gap-y-[2px] text-[12px] text-xyne-fg-secondary">
            {hasPending ? (
              <span className="font-medium text-xyne-warning-fg">
                {status.pendingCandidates} memor{status.pendingCandidates === 1 ? "y" : "ies"} pending review
              </span>
            ) : status.approvedCandidates > 0 ? (
              <span>
                {status.approvedCandidates} approved memor{status.approvedCandidates === 1 ? "y" : "ies"}
              </span>
            ) : (
              <span className="text-xyne-fg-muted">
                No memories yet — run a backfill or upload a .md to get started
              </span>
            )}
            {status.mdFileCount > 0 && (
              <span className="text-xyne-fg-tertiary">
                · {status.mdFileCount} uploaded file{status.mdFileCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
