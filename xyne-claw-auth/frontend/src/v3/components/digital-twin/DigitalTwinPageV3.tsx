import { useState, useCallback, useRef } from "react";
import {
  BrainIcon,
  GearSixIcon,
  PowerIcon,
  ChartLineUpIcon,
} from "@phosphor-icons/react";
import { useDigitalTwin } from "../../hooks/useDigitalTwin";
import { DigitalTwinBanner } from "./DigitalTwinBanner";
import { DigitalTwinMemoriesTab } from "./DigitalTwinMemoriesTab";
import { DigitalTwinMetricsPageV3 } from "./DigitalTwinMetricsPageV3";
import { ReviewPanel } from "./ReviewPanel";
import { EnableModal } from "./EnableModal";
import { DisableModal } from "./DisableModal";
import { SettingsModal } from "./SettingsModal";
import { MemoryApprovalCard } from "./MemoryApprovalCard";
import { UploadModal } from "./UploadModal";
import { Tooltip } from "../ui/Tooltip";

interface DigitalTwinPageV3Props {
  userId: string;
}

export function DigitalTwinPageV3({ userId }: DigitalTwinPageV3Props) {
  const { status, loading, error, reload, backfillStalled } = useDigitalTwin(userId);

  const [showMetrics,       setShowMetrics]       = useState(false);
  const [showEnable,        setShowEnable]        = useState(false);
  const [enableMode,        setEnableMode]        = useState<"enable" | "backfill">("enable");
  const [showDisable,       setShowDisable]       = useState(false);
  const [showSettings,      setShowSettings]      = useState(false);
  const [showUpload,        setShowUpload]        = useState(false);
  const [reviewRefreshKey,  setReviewRefreshKey]  = useState(0);

  /* ── Resizable split between Memories (left) and Controls (right) ── */
  const gridRef = useRef<HTMLDivElement>(null);
  const [leftPct, setLeftPct] = useState(60);

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const el = gridRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      // Clamp so neither column collapses past a usable width.
      setLeftPct(Math.min(78, Math.max(30, pct)));
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
  }, [reload]);

  const handleEnable   = () => { setEnableMode("enable");   setShowEnable(true); };
  const handleBackfill = () => { setEnableMode("backfill"); setShowEnable(true); };

  const backfillRunning = !!(
    status?.enabled &&
    status.backfillState &&
    Object.values(status.backfillState).some((s) => !s.complete)
  );

  // Banner only needs enable + disable (for stalled CTA)
  const bannerProps = {
    status,
    loading,
    backfillStalled,
    onEnable:  handleEnable,
    onDisable: () => setShowDisable(true),
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Page header — hidden when metrics view is active ── */}
      <div className={`shrink-0 border-b border-xyne-border bg-xyne-surface ${showMetrics ? "hidden" : ""}`}>
        <div className="flex items-center gap-[12px] px-[24px] py-[14px]">
          <BrainIcon size={22} className="text-xyne-brand" />
          <div>
            <h1 className="text-[16px] font-semibold text-xyne-fg-primary">Digital Twin</h1>
            <p className="text-[12px] text-xyne-fg-secondary">
              Learns from your work, speaks in your voice — every memory approved by you
            </p>
          </div>

          <div className="ml-auto flex items-center gap-[8px]">
            {/* Metrics button — always visible */}
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

            {/* Settings + Disable — shown when Twin is on */}
            {status?.enabled && (
              <>
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
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      {!showMetrics ? (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 flex-1 justify-center overflow-hidden">
            <div
              ref={gridRef}
              className="grid min-h-0 w-full max-w-[1280px] grid-rows-[minmax(0,1fr)] overflow-hidden"
              style={{ gridTemplateColumns: `${leftPct}% 7px minmax(0, 1fr)` }}
            >

              {/* LEFT: Memories */}
              <div className="min-h-0 overflow-hidden">
                <DigitalTwinMemoriesTab userId={userId} onCandidateApproved={reloadAll} />
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
