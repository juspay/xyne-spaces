import { useState, useCallback } from "react";
import {
  BrainIcon,
  GearSixIcon,
  PowerIcon,
} from "@phosphor-icons/react";
import { useDigitalTwin } from "../../hooks/useDigitalTwin";
import { DigitalTwinBanner } from "./DigitalTwinBanner";
import { DigitalTwinMemoriesTab } from "./DigitalTwinMemoriesTab";
import { ReviewPanel } from "./ReviewPanel";
import { EnableModal } from "./EnableModal";
import { DisableModal } from "./DisableModal";
import { SettingsModal } from "./SettingsModal";
import { UploadModal } from "./UploadModal";
import { Tooltip } from "../ui/Tooltip";

interface DigitalTwinPageV3Props {
  userId: string;
}

export function DigitalTwinPageV3({ userId }: DigitalTwinPageV3Props) {
  const { status, loading, error, reload, backfillStalled } = useDigitalTwin(userId);

  const [showEnable,        setShowEnable]        = useState(false);
  const [enableMode,        setEnableMode]        = useState<"enable" | "backfill">("enable");
  const [showDisable,       setShowDisable]       = useState(false);
  const [showSettings,      setShowSettings]      = useState(false);
  const [showUpload,        setShowUpload]        = useState(false);
  const [reviewRefreshKey,  setReviewRefreshKey]  = useState(0);

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

      {/* ── Page header ── */}
      <div className="shrink-0 border-b border-xyne-border bg-xyne-surface">
        <div className="flex items-center gap-[12px] px-[24px] py-[14px]">
          <BrainIcon size={22} className="text-xyne-brand" />
          <div>
            <h1 className="text-[16px] font-semibold text-xyne-fg-primary">Digital Twin</h1>
            <p className="text-[12px] text-xyne-fg-secondary">
              Learns from your work, speaks in your voice — every memory approved by you
            </p>
          </div>

          {/* Settings + Disable — shown when Twin is on */}
          {status?.enabled && (
            <div className="ml-auto flex items-center gap-[8px]">
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

      {/* ── Body — always two-column: memories left (60%), controls right (40%) ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 flex-1 justify-center overflow-hidden">
          <div className="grid min-h-0 w-full max-w-[1280px] grid-cols-[3fr_2fr] overflow-hidden">

            {/* LEFT (60%): Memories — always present */}
            <div className="min-h-0 overflow-hidden border-r border-xyne-border">
              <DigitalTwinMemoriesTab userId={userId} onCandidateApproved={reloadAll} />
            </div>

            {/* RIGHT (40%): Controls */}
            <div className="flex flex-col gap-[16px] overflow-y-auto p-[20px]">

              {/* Card 1: Status banner */}
              <DigitalTwinBanner {...bannerProps} />

              {error && <ErrorBanner message={error} onRetry={reloadAll} />}

              {/* ── Section 2: Review ── */}
              {status?.enabled && (
                <ReviewPanel
                  userId={userId}
                  refreshKey={reviewRefreshKey}
                  onApproved={reloadAll}
                  onBackfill={handleBackfill}
                  onUpload={() => setShowUpload(true)}
                />
              )}

              {/* Disabled: muted review placeholder */}
              {!status?.enabled && (
                <div className="rounded-xl border border-xyne-border bg-xyne-surface-sunken p-[14px]">
                  <p className="text-[12px] font-semibold text-xyne-fg-muted">Review</p>
                  <p className="mt-[3px] text-[11px] leading-relaxed text-xyne-fg-tertiary">
                    Enable your Twin to start reviewing memories.
                  </p>
                </div>
              )}

              {/* Response suffix */}
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
