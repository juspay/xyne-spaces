import { useState, useCallback, useRef, useEffect } from "react";
import {
  BrainIcon,
  GearSixIcon,
  PowerIcon,
  ChartLineUpIcon,
  ChatCenteredDotsIcon,
  FunnelIcon,
  ArrowsClockwiseIcon,
  FileTextIcon,
} from "@phosphor-icons/react";
import { useDigitalTwin } from "../../hooks/useDigitalTwin";
import { DigitalTwinBanner } from "./DigitalTwinBanner";
import { DigitalTwinLanding } from "./DigitalTwinLanding";
import { DigitalTwinMemoriesTab } from "./DigitalTwinMemoriesTab";
import { DigitalTwinFilesTab } from "./DigitalTwinFilesTab";
import { DigitalTwinMetricsPageV3 } from "./DigitalTwinMetricsPageV3";
import { DigitalTwinReplyActivityPageV3 } from "./DigitalTwinReplyActivityPageV3";
import { DigitalTwinPipelinePageV3 } from "./DigitalTwinPipelinePageV3";
import { ReviewPanel } from "./ReviewPanel";
import { EnableModal } from "./EnableModal";
import { DisableModal } from "./DisableModal";
import { SettingsModal } from "./SettingsModal";
import { MemoryApprovalCard } from "./MemoryApprovalCard";
import { UploadModal } from "./UploadModal";
import { Tooltip } from "../ui/Tooltip";
import { pauseDigitalTwinBackfill, resumeDigitalTwinBackfill, checkIsAdmin } from "../../../lib/api";

interface DigitalTwinPageV3Props {
  userId: string;
}

export function DigitalTwinPageV3({ userId }: DigitalTwinPageV3Props) {
  const { status, loading, error, reload, backfillStalled } = useDigitalTwin(userId);

  const [showMetrics,       setShowMetrics]       = useState(false);
  const [showReplyMetrics,  setShowReplyMetrics]  = useState(false);
  const [isAdmin,           setIsAdmin]           = useState(false);
  const [showPersona,       setShowPersona]       = useState(false);
  const [showPipeline,      setShowPipeline]      = useState(false);
  /** Event to auto-expand when opening the pipeline (deep-link from a memory's
   *  "View reasoning"). Null = open the pipeline at the top. */
  const [pipelineTargetEvent, setPipelineTargetEvent] = useState<string | null>(null);
  const [showEnable,        setShowEnable]        = useState(false);
  const [enableMode,        setEnableMode]        = useState<"enable" | "backfill">("enable");
  const [showDisable,       setShowDisable]       = useState(false);
  const [showSettings,      setShowSettings]      = useState(false);
  const [showUpload,        setShowUpload]        = useState(false);
  const [reviewRefreshKey,  setReviewRefreshKey]  = useState(0);

  // Reply-activity metrics are an admin cross-user surface (control-center);
  // gate the entry point on the claw-admin role.
  useEffect(() => {
    let cancelled = false;
    void checkIsAdmin(userId)
      .then((v) => { if (!cancelled) setIsAdmin(v); })
      .catch(() => { /* non-admin / check failed → button stays hidden */ });
    return () => { cancelled = true; };
  }, [userId]);

  /* ── Resizable split between Memories (left) and Controls (right) ── */
  const gridRef = useRef<HTMLDivElement>(null);
  const [leftPct, setLeftPct] = useState(72);

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const el = gridRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      // Clamp so neither column collapses past a usable width.
      setLeftPct(Math.min(85, Math.max(30, pct)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const reloadAll = useCallback(() => {
    reload();
    setReviewRefreshKey((k) => k + 1);
    // Cluster-approve returns 202 (candidate status flips a moment later) and
    // Hindsight retain is async, so an immediate refetch can race the settle —
    // leaving the right-panel review list / counts stale until a manual
    // close-reopen. Re-sync once more shortly after so both panels reflect the
    // settled state live (covers approve AND reject).
    window.setTimeout(() => {
      reload();
      setReviewRefreshKey((k) => k + 1);
    }, 1800);
  }, [reload]);

  const handleEnable   = () => { setEnableMode("enable");   setShowEnable(true); };
  const handleBackfill = () => { setEnableMode("backfill"); setShowEnable(true); };

  // Pause / resume the running backfill. Both keep the Twin enabled and preserve
  // the cursor; we reload status right after so the banner flips state.
  const [backfillActionBusy, setBackfillActionBusy] = useState(false);
  const handlePauseBackfill = useCallback(async () => {
    if (!userId || backfillActionBusy) return;
    setBackfillActionBusy(true);
    try { await pauseDigitalTwinBackfill(userId); } catch { /* status reload surfaces any error */ }
    finally { setBackfillActionBusy(false); reloadAll(); }
  }, [userId, backfillActionBusy, reloadAll]);
  const handleResumeBackfill = useCallback(async () => {
    if (!userId || backfillActionBusy) return;
    setBackfillActionBusy(true);
    try { await resumeDigitalTwinBackfill(userId); } catch { /* status reload surfaces any error */ }
    finally { setBackfillActionBusy(false); reloadAll(); }
  }, [userId, backfillActionBusy, reloadAll]);
  const openPipeline   = (eventId?: string) => { setPipelineTargetEvent(eventId ?? null); setShowPipeline(true); };
  const closePipeline  = () => { setShowPipeline(false); setPipelineTargetEvent(null); };

  const backfillRunning = !!(
    status?.enabled &&
    status.backfillState &&
    Object.values(status.backfillState).some((s) => !s.complete)
  );

  // Banner needs enable + disable (stalled CTA) + a way to open Activity while
  // a backfill is running (the Activity button moves into the banner then).
  const bannerProps = {
    status,
    loading,
    backfillStalled,
    onEnable:  handleEnable,
    onDisable: () => setShowDisable(true),
    onViewActivity: () => openPipeline(),
    onPause:  handlePauseBackfill,
    onResume: handleResumeBackfill,
    backfillActionBusy,
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Page header — hidden when a full-page overlay is active ── */}
      <div className={`shrink-0 border-b border-xyne-border bg-xyne-surface ${showMetrics || showReplyMetrics || showPipeline || showPersona ? "hidden" : ""}`}>
        <div className="flex items-center gap-[12px] px-[24px] py-[14px]">
          <BrainIcon size={22} className="text-xyne-brand" />
          <div>
            <h1 className="text-[18px] font-semibold text-xyne-fg-primary" style={{ fontFamily: "var(--comp-font-serif)" }}>Digital Twin</h1>
            <p className="text-[12px] text-xyne-fg-secondary">
              Learns from your work, speaks in your voice — every memory approved by you
            </p>
          </div>

          {/* Actions — only meaningful once the Twin is on. When off, the
              full-width landing carries the single Enable call-to-action. */}
          {status?.enabled && (
            <div className="ml-auto flex items-center gap-[8px]">
              <Tooltip content="View approval metrics" side="bottom">
                <button
                  onClick={() => setShowMetrics(true)}
                  className={`flex items-center gap-[6px] rounded-lg border px-[10px] py-[6px] text-[12px] font-medium transition ${
                    showMetrics
                      ? "border-xyne-brand bg-xyne-brand/8 text-xyne-brand"
                      : "border-xyne-border bg-xyne-surface text-xyne-fg-secondary shadow-sm hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
                  }`}
                  aria-label="Approval Metrics"
                >
                  <ChartLineUpIcon size={14} />
                  <span>Metrics</span>
                </button>
              </Tooltip>

              {isAdmin && (
                <Tooltip content="Reply activity — draft approvals/edits/declines/ignored, response time, and the respond gate (admin, cross-user)" side="bottom">
                  <button
                    onClick={() => setShowReplyMetrics(true)}
                    className={`flex items-center gap-[6px] rounded-lg border px-[10px] py-[6px] text-[12px] font-medium transition ${
                      showReplyMetrics
                        ? "border-xyne-brand bg-xyne-brand/8 text-xyne-brand"
                        : "border-xyne-border bg-xyne-surface text-xyne-fg-secondary shadow-sm hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
                    }`}
                    aria-label="Reply activity"
                  >
                    <ChatCenteredDotsIcon size={14} />
                    <span>Reply activity</span>
                  </button>
                </Tooltip>
              )}

              <Tooltip content="Your persona files — soul.md and more. Edit them and choose which load into your Twin's prompt." side="bottom">
                <button
                  onClick={() => setShowPersona(true)}
                  className="flex items-center gap-[6px] rounded-lg border border-xyne-border bg-xyne-surface px-[10px] py-[6px] text-[12px] font-medium text-xyne-fg-secondary shadow-sm transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
                  aria-label="Persona files"
                >
                  <FileTextIcon size={14} weight="duotone" />
                  <span>Persona</span>
                </button>
              </Tooltip>

              {/* Activity + Backfill — the curation actions, grouped together.
                  While a backfill runs, the Activity entry lives inside the
                  backfilling banner instead (clearer link to the progress). */}
              {!backfillRunning && (
                <div className="flex items-center gap-[8px] border-r border-xyne-border pr-[8px]">
                  <Tooltip content="Memory activity — every curator run: what it read, proposed, and what you've accepted" side="bottom">
                    <button
                      onClick={() => openPipeline()}
                      className="flex items-center gap-[6px] rounded-lg border border-xyne-border bg-xyne-surface px-[10px] py-[6px] text-[12px] font-medium text-xyne-fg-secondary shadow-sm transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
                      aria-label="Memory activity"
                    >
                      <FunnelIcon size={14} weight="duotone" />
                      <span>Activity</span>
                    </button>
                  </Tooltip>

                  <Tooltip content="Scan your Spaces history and propose new memories" side="bottom">
                    <button
                      onClick={handleBackfill}
                      className="flex items-center gap-[6px] rounded-lg border border-xyne-border bg-xyne-surface px-[10px] py-[6px] text-[12px] font-medium text-xyne-fg-secondary shadow-sm transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
                      aria-label="Backfill history"
                    >
                      <ArrowsClockwiseIcon size={14} />
                      <span>Backfill</span>
                    </button>
                  </Tooltip>
                </div>
              )}

              <Tooltip content="Configure Twin behavior — response suffix, preferences" side="bottom">
                <button
                  onClick={() => setShowSettings(true)}
                  className="flex h-[32px] w-[32px] items-center justify-center rounded-lg border border-xyne-border bg-xyne-surface text-xyne-fg-secondary shadow-sm transition hover:bg-xyne-surface-sunken hover:text-xyne-fg-primary"
                  aria-label="Settings"
                >
                  <GearSixIcon size={15} weight="duotone" />
                </button>
              </Tooltip>
              <button
                onClick={() => setShowDisable(true)}
                className="flex items-center gap-[6px] rounded-lg border border-xyne-error-fg/30 bg-xyne-error-fg/8 px-[10px] py-[6px] text-xyne-error-fg transition hover:bg-xyne-error-fg/15"
                aria-label="Disable Twin"
              >
                <PowerIcon size={14} weight="duotone" />
                <span className="text-[12px] font-medium">Disable</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      {showPipeline ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <DigitalTwinPipelinePageV3
            userId={userId}
            live={backfillRunning}
            initialEventId={pipelineTargetEvent}
            onBack={closePipeline}
          />
        </div>
      ) : showPersona ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <DigitalTwinFilesTab userId={userId} onBack={() => setShowPersona(false)} />
        </div>
      ) : !loading && status && !status.enabled ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <DigitalTwinLanding onEnable={handleEnable} />
        </div>
      ) : showReplyMetrics ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <DigitalTwinReplyActivityPageV3
            userId={userId}
            isAdmin={isAdmin}
            onBack={() => setShowReplyMetrics(false)}
          />
        </div>
      ) : !showMetrics ? (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 flex-1 justify-center overflow-hidden">
            {/* Full width: the constellation is the focus of this screen, and a
                1280px cap left dead gutters on either side at desktop widths. */}
            <div
              ref={gridRef}
              className="grid min-h-0 w-full grid-rows-[minmax(0,1fr)] overflow-hidden"
              style={{ gridTemplateColumns: `${leftPct}% 7px minmax(0, 1fr)` }}
            >

              {/* LEFT: Memories */}
              <div className="min-h-0 overflow-hidden">
                <DigitalTwinMemoriesTab userId={userId} onCandidateApproved={reloadAll} onViewReasoning={openPipeline} />
              </div>

              {/* DIVIDER — drag to resize */}
              <div
                onMouseDown={startDrag}
                role="separator"
                aria-orientation="vertical"
                title="Drag to resize"
                className="group relative cursor-col-resize select-none"
              >
                <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-xyne-border transition-colors group-hover:bg-xyne-brand" />
                {/* Wider invisible hit area is the whole 7px column */}
              </div>

              {/* RIGHT: Controls */}
              <div className="flex min-h-0 flex-col gap-[16px] overflow-y-auto p-[20px] [&>*]:shrink-0">

                <DigitalTwinBanner {...bannerProps} />

                {error && <ErrorBanner message={error} onRetry={reloadAll} />}

                {status?.enabled && (
                  <ReviewPanel
                    userId={userId}
                    refreshKey={reviewRefreshKey}
                    onApproved={reloadAll}
                    onBackfill={handleBackfill}
                    onUpload={() => setShowUpload(true)}
                  />
                )}

                {status?.enabled && (
                  <MemoryApprovalCard
                    userId={userId}
                    approvalMode={status.memoryApprovalMode ?? "manual"}
                    minScore={status.memoryAutoApproveMinScore ?? 0.9}
                    onSaved={reloadAll}
                  />
                )}

                {!status?.enabled && (
                  <div className="rounded-xl border border-xyne-border bg-xyne-surface-sunken p-[14px]">
                    <p className="text-[12px] font-semibold text-xyne-fg-muted">Review</p>
                    <p className="mt-[3px] text-[11px] leading-relaxed text-xyne-fg-tertiary">
                      Enable your Twin to start reviewing memories.
                    </p>
                  </div>
                )}

                {status?.enabled && status.responseSuffix && (
                  <div className="rounded-xl border border-xyne-border bg-xyne-surface-sunken p-[14px]">
                    <p className="mb-[6px] text-[10px] font-semibold uppercase tracking-[0.08em] text-xyne-fg-muted">
                      Response suffix
                    </p>
                    <p className="text-[12px] italic leading-relaxed text-xyne-fg-secondary">
                      &ldquo;{status.responseSuffix}&rdquo;
                    </p>
                  </div>
                )}

              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          <DigitalTwinMetricsPageV3 userId={userId} onBack={() => setShowMetrics(false)} />
        </div>
      )}

      {/* ── Modals ── */}
      <EnableModal
        userId={userId}
        open={showEnable}
        mode={enableMode}
        onClose={() => setShowEnable(false)}
        onEnabled={() => { setShowEnable(false); reloadAll(); }}
      />
      <DisableModal
        userId={userId}
        open={showDisable}
        onClose={() => setShowDisable(false)}
        onDisabled={() => { setShowDisable(false); reloadAll(); }}
      />
      <SettingsModal
        userId={userId}
        open={showSettings}
        initialSuffix={status?.responseSuffix ?? ""}
        initialRespondPolicy={status?.respondPolicy ?? "always"}
        onClose={() => setShowSettings(false)}
        onSaved={() => { setShowSettings(false); reloadAll(); }}
      />
      <UploadModal
        userId={userId}
        open={showUpload}
        onClose={() => setShowUpload(false)}
        onUploaded={() => { setShowUpload(false); reloadAll(); }}
      />
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-xyne-border bg-xyne-error-bg p-[12px] text-[12px] text-xyne-error-fg">
      {message}{" "}
      <button onClick={onRetry} className="underline">Retry</button>
    </div>
  );
}
