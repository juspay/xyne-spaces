import {
  CheckCircleIcon,
  WarningCircleIcon,
  SpinnerGapIcon,
  WarningIcon,
  BrainIcon,
  FunnelIcon,
  PauseIcon,
  PlayIcon,
} from "@phosphor-icons/react";
import { InfoIcon } from "../ui/Tooltip";
import type { DigitalTwinStatus, DigitalTwinBackfillEntry } from "../../../lib/api";

/** Per-source progress cards — shared by the running AND paused banner states so
 *  the "where each source stopped" view is identical. `stalled`/`paused` only
 *  change the badge + bar treatment for the incomplete sources. */
function SourceGrid({
  backfillState,
  stalled,
  paused,
}: {
  backfillState: Record<string, DigitalTwinBackfillEntry>;
  stalled: boolean;
  paused: boolean;
}) {
  return (
    <div
      className="grid gap-[1px] bg-xyne-border"
      style={{ gridTemplateColumns: `repeat(${Object.keys(backfillState).length}, 1fr)` }}
    >
      {Object.entries(backfillState).map(([source, entry]) => {
        const to = new Date(entry.to);
        const from = new Date(entry.from);
        const cursor = new Date(entry.cursor);
        const total = to.getTime() - from.getTime();
        // Chronological walk: cursor advances from `from` → `to`.
        const elapsed = cursor.getTime() - from.getTime();
        const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((elapsed / total) * 100))) : 100;
        const isPaused = paused && !entry.complete;
        const isStuck = stalled && !entry.complete;
        const fillWidth = entry.complete ? 100 : isStuck || isPaused ? Math.max(pct, 4) : pct;
        const barOpacity = entry.complete
          ? "opacity-100"
          : isPaused
          ? "opacity-40"
          : isStuck
          ? "opacity-30"
          : pct > 0
          ? "opacity-60"
          : "opacity-0";

        const badgeLabel = entry.complete
          ? "Done ✓"
          : isPaused
          ? "Paused"
          : isStuck
          ? "Stalled"
          : pct > 0
          ? `${pct}%`
          : "Queued";
        const badgeCls = entry.complete
          ? "bg-xyne-success-fg text-white"
          : isPaused
          ? "border border-xyne-border bg-xyne-surface-sunken text-xyne-fg-secondary"
          : isStuck
          ? "border border-xyne-warning-fg/50 bg-xyne-warning-fg/10 text-xyne-warning-fg"
          : pct > 0
          ? "bg-xyne-fg-primary/15 text-xyne-fg-primary"
          : "bg-xyne-border text-xyne-fg-muted";

        return (
          <div key={source} className="flex flex-col gap-[8px] bg-xyne-surface p-[12px]">
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
  );
}

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
  /** Open the Activity (pipeline) view — shown inside the backfilling banner so
   *  users connect the live progress to the run feed. */
  onViewActivity?: () => void;
  /** Pause the running backfill (keeps progress). */
  onPause?: () => void;
  /** Resume a paused (or wedged) backfill from its cursor. */
  onResume?: () => void;
  /** True while a pause/resume request is in flight — disables the buttons. */
  backfillActionBusy?: boolean;
}

export function DigitalTwinBanner({
  status,
  loading,
  backfillStalled = false,
  onEnable,
  onDisable,
  onViewActivity,
  onPause,
  onResume,
  backfillActionBusy = false,
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

  // Prefer the server-normalized block (knows paused/stalled authoritatively);
  // fall back to the raw state for older responses.
  const overall = status.backfill?.overall ?? null;
  const paused = overall?.paused === true;
  const rawIncomplete = status.backfillState
    ? Object.values(status.backfillState).some((s) => !s.complete)
    : false;
  const backfillRunning = overall ? overall.running : rawIncomplete;
  // A paused backfill must NEVER read as stalled (the whole point of pausing).
  const isStalled = paused ? false : overall?.stalled ?? backfillStalled;

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

  // Overall % — prefer the server's windows-based number; fall back to a
  // cursor-time average across sources.
  const overallPct = (() => {
    if (overall && typeof overall.pctByWindows === "number") return overall.pctByWindows;
    const entries = Object.values(status.backfillState ?? {});
    if (entries.length === 0) return 0;
    return Math.round(
      entries.reduce((sum, e) => {
        if (e.complete) return sum + 100;
        const total = new Date(e.to).getTime() - new Date(e.from).getTime();
        const elapsed = new Date(e.cursor).getTime() - new Date(e.from).getTime();
        return sum + (total > 0 ? Math.min(100, Math.round((elapsed / total) * 100)) : 100);
      }, 0) / entries.length,
    );
  })();

  // ── State: Paused ───────────────────────────────────────────────────
  if (paused) {
    return (
      <div className="rounded-xl border border-xyne-border bg-xyne-surface overflow-hidden">
        <div className="h-[2px] w-full bg-xyne-border" />
        <div className="flex items-center gap-[8px] border-b border-xyne-border px-[14px] py-[10px]">
          <PauseIcon size={14} weight="fill" className="shrink-0 text-xyne-fg-muted" />
          <span className="text-[12px] font-medium text-xyne-fg-primary">Backfill paused</span>
          <span className="text-[11px] tabular-nums text-xyne-fg-muted">{overallPct}%</span>
          <div className="ml-auto flex items-center gap-[6px]">
            {onViewActivity && (
              <button
                onClick={onViewActivity}
                className="flex items-center gap-[5px] rounded-lg border border-xyne-border bg-xyne-surface px-[9px] py-[4px] text-[11px] font-medium text-xyne-fg-secondary transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
                aria-label="View memory activity"
              >
                <FunnelIcon size={12} weight="duotone" />
                Activity
              </button>
            )}
            {onResume && (
              <button
                onClick={onResume}
                disabled={backfillActionBusy}
                className="flex items-center gap-[5px] rounded-lg bg-xyne-fg-primary px-[10px] py-[4px] text-[11px] font-semibold text-white transition hover:opacity-90 active:opacity-80 disabled:opacity-50"
                aria-label="Resume backfill"
              >
                <PlayIcon size={12} weight="fill" />
                Resume
              </button>
            )}
          </div>
        </div>
        {status.backfillState && (
          <SourceGrid backfillState={status.backfillState} stalled={false} paused />
        )}
      </div>
    );
  }

  // ── State: Backfilling ──────────────────────────────────────────────
  if (backfillRunning) {
    return (
      <div className="rounded-xl border border-xyne-border bg-xyne-surface overflow-hidden">
        <style>{`@keyframes dt-slide { 0%{transform:translateX(-130%)} 100%{transform:translateX(400%)} }`}</style>

        {/* ── Top accent bar ── */}
        {isStalled ? (
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
        {isStalled && (
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
          {isStalled
            ? <WarningCircleIcon size={14} className="shrink-0 text-xyne-fg-muted" />
            : <SpinnerGapIcon size={14} className="animate-spin shrink-0 text-xyne-fg-muted" />
          }
          <span className="text-[12px] font-medium text-xyne-fg-primary">
            Backfilling your history
          </span>
          <span className="text-[11px] tabular-nums text-xyne-fg-muted">{overallPct}%</span>
          <div className="ml-auto flex items-center gap-[6px]">
            {onViewActivity && (
              <button
                onClick={onViewActivity}
                className="flex items-center gap-[5px] rounded-lg border border-xyne-border bg-xyne-surface px-[9px] py-[4px] text-[11px] font-medium text-xyne-fg-secondary transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
                aria-label="View memory activity"
              >
                <FunnelIcon size={12} weight="duotone" />
                Activity
              </button>
            )}
            {onPause && (
              <button
                onClick={onPause}
                disabled={backfillActionBusy}
                className="flex items-center gap-[5px] rounded-lg border border-xyne-border bg-xyne-surface px-[9px] py-[4px] text-[11px] font-medium text-xyne-fg-secondary transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary disabled:opacity-50"
                aria-label="Pause backfill"
              >
                <PauseIcon size={12} weight="fill" />
                Pause
              </button>
            )}
          </div>
        </div>

        {/* ── Per-source compact cards ── */}
        {status.backfillState && (
          <SourceGrid backfillState={status.backfillState} stalled={isStalled} paused={false} />
        )}
      </div>
    );
  }

  // ── State: Active ───────────────────────────────────────────────────
  const hasPending = status.pendingCandidates > 0;
  // Real memory count (Hindsight), NOT approvedCandidates — the latter counts
  // approved candidate rows and over-reports vs the memories tab.
  const approved = status.memoryCount ?? status.approvedCandidates;

  return (
    <div className="relative overflow-hidden rounded-xl border border-xyne-border bg-xyne-surface">
      {/* soft accent glow */}
      <div
        className="pointer-events-none absolute -right-[50px] -top-[50px] h-[170px] w-[170px] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(21,128,61,0.10), transparent 70%)" }}
      />
      <div className="relative p-[16px]">
        <div className="flex items-center gap-[7px]">
          <span className="relative flex h-[7px] w-[7px]">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-xyne-success-fg opacity-60" />
            <span className="relative inline-flex h-[7px] w-[7px] rounded-full bg-xyne-success-fg" />
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-xyne-fg-tertiary">Digital Twin · active</span>
          <span className="ml-[2px]"><InfoIcon text={TOOLTIPS.label} /></span>
        </div>

        <p className="mt-[10px] text-[19px] leading-[1.15] text-xyne-fg-primary" style={{ fontFamily: "var(--comp-font-serif)" }}>
          {approved > 0 ? (
            <>Speaking as you, from <span className="italic">{approved}</span> {approved === 1 ? "memory" : "memories"}.</>
          ) : (
            "Ready to learn your voice."
          )}
        </p>

        <p className="mt-[6px] text-[12px] leading-relaxed text-xyne-fg-secondary">
          {hasPending ? (
            <><span className="font-semibold text-xyne-warning-fg">{status.pendingCandidates} pending</span> your review below.</>
          ) : approved > 0 ? (
            "All caught up — every memory approved by you."
          ) : (
            "Run a backfill or upload a .md to get started."
          )}
          {status.mdFileCount > 0 && (
            <span className="text-xyne-fg-tertiary"> · {status.mdFileCount} uploaded file{status.mdFileCount !== 1 ? "s" : ""}</span>
          )}
        </p>
      </div>
    </div>
  );
}
