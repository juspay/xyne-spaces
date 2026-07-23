/**
 * V3 MemoryTab — thin wrapper around the V2 (V1-shared) MemoryTab
 * implementation. The V2 component is feature-complete: enrolment toggle,
 * stats, hot/pending/candidates/graph/recall-tester sub-views, and
 * backfill modal. Rebuilding it in V3 would duplicate ~1700 LOC for no
 * functional gain.
 *
 * Props:
 *   agent      — supplies the slug for memory API calls and the config used by
 *                agent-level memory settings
 *   canDelete  — gates the trash buttons on individual memory rows; in V3
 *                this maps to the agent permissions' canEdit flag.
 *
 * Known caveat: the V2 component is styled with the dark `zinc-*` palette
 * rather than V3's `xyne-*` tokens, so it visually drifts from the rest
 * of V3 in light mode. Re-styling is a future pass — the goal here is
 * functional alignment with V1 (the user explicitly asked for it).
 */
import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import type { Agent } from "../../../../lib/types";
import { updateAgent } from "../../../../lib/api";
import { MemoryTab as MemoryTabV2 } from "../../../../v2/components/MemoryTab";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { Switch } from "../../ui/Switch";

interface Props {
  agent: Agent;
  canDelete?: boolean;
}

const DEFAULT_MIN_CONFIDENCE = 0.8;

function readMinConfidence(config: Record<string, unknown>): number {
  const value = config.memoryAutoApproveMinConfidence;
  return typeof value === "number" && value >= 0.5 && value <= 1
    ? value
    : DEFAULT_MIN_CONFIDENCE;
}

export function MemoryTab({ agent, canDelete = false }: Props) {
  const agentSlug = agent.slug;
  const initialAutoApprove = agent.config.memoryAutoApprove === true;
  const initialMinConfidence = readMinConfidence(agent.config);
  const [autoApprove, setAutoApprove] = useState(initialAutoApprove);
  const [minConfidence, setMinConfidence] = useState(initialMinConfidence);
  const [savedMinConfidence, setSavedMinConfidence] = useState(initialMinConfidence);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [clearing, setClearing] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  async function persistSettings(nextAutoApprove: boolean, nextMinConfidence: number): Promise<void> {
    setSavingSettings(true);
    setSettingsError(null);
    try {
      const config = {
        ...agent.config,
        memoryAutoApprove: nextAutoApprove,
        memoryAutoApproveMinConfidence: nextMinConfidence,
      };
      await updateAgent(agent.slug, { config });
      agent.config.memoryAutoApprove = nextAutoApprove;
      agent.config.memoryAutoApproveMinConfidence = nextMinConfidence;
      setSavedMinConfidence(nextMinConfidence);
    } catch (err) {
      setAutoApprove(agent.config.memoryAutoApprove === true);
      setMinConfidence(readMinConfidence(agent.config));
      setSettingsError(err instanceof Error ? err.message : "Failed to save memory settings.");
    } finally {
      setSavingSettings(false);
    }
  }

  function handleAutoApproveChange(nextAutoApprove: boolean): void {
    setAutoApprove(nextAutoApprove);
    void persistSettings(nextAutoApprove, minConfidence);
  }

  function commitMinConfidence(): void {
    if (autoApprove && minConfidence !== savedMinConfidence) {
      void persistSettings(true, minConfidence);
    }
  }

  async function clearAllMemories(): Promise<void> {
    if (confirmation !== agentSlug) return;
    setClearing(true);
    setNotice(null);
    try {
      const res = await fetch(`/claw/api/v1/memory/banks/${encodeURIComponent(agentSlug)}/clear-all`, {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json() as {
        success?: boolean;
        data?: { deleted?: number };
        error?: string;
      };
      if (!res.ok || !body.success) {
        setNotice({ kind: "error", text: body.error ?? `Clear failed: ${res.status}` });
        return;
      }

      const deleted = body.data?.deleted ?? 0;
      setNotice({
        kind: "success",
        text: `Cleared ${deleted} ${deleted === 1 ? "memory" : "memories"}.`,
      });
      setShowClearConfirm(false);
      setConfirmation("");
      setRefreshKey((key) => key + 1);
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "Failed to clear memories." });
    } finally {
      setClearing(false);
    }
  }

  return (
    <>
      {canDelete && (
        <div className="px-4 pt-4">
          <div className="mb-3 rounded-xl border border-xyne-border bg-xyne-surface-sunken p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-xyne-fg-primary">Auto-approve memories</div>
                <div className="mt-1 text-[12px] leading-relaxed text-xyne-fg-tertiary">
                  Memories from the nightly curator with confidence at or above this threshold are retained automatically; lower-confidence candidates still queue for review.
                </div>
              </div>
              <Switch checked={autoApprove} onChange={handleAutoApproveChange} disabled={savingSettings} />
            </div>

            {autoApprove && (
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between text-[12px]">
                  <label htmlFor="memory-auto-approve-confidence" className="font-medium text-xyne-fg-secondary">
                    Min confidence
                  </label>
                  <span className="font-mono text-xyne-fg-primary">{Math.round(minConfidence * 100)}%</span>
                </div>
                <input
                  id="memory-auto-approve-confidence"
                  type="range"
                  min={0.5}
                  max={1}
                  step={0.05}
                  value={minConfidence}
                  disabled={savingSettings}
                  onChange={(event) => setMinConfidence(Number(event.target.value))}
                  onMouseUp={commitMinConfidence}
                  onTouchEnd={commitMinConfidence}
                  onKeyUp={commitMinConfidence}
                  className="w-full accent-xyne-brand disabled:opacity-50"
                />
                <div className="mt-0.5 flex justify-between text-[10px] text-xyne-fg-tertiary">
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </div>
            )}

            {settingsError && <div className="mt-2 text-[11px] text-xyne-error-fg">{settingsError}</div>}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-xyne-error-fg/30 bg-xyne-error-bg/40 p-3">
            <div>
              <div className="text-[13px] font-semibold text-xyne-fg-primary">Memory cleanup</div>
              <div className="text-[12px] text-xyne-fg-tertiary">Permanently remove every memory in this agent&apos;s bank.</div>
            </div>
            <Button
              variant="destructive"
              size="sm"
              leadingIcon={<Trash2 size={13} />}
              onClick={() => {
                setConfirmation("");
                setShowClearConfirm(true);
              }}
            >
              Clear all memories
            </Button>
          </div>
        </div>
      )}

      {notice && (
        <div className="px-4 pt-3">
          <div className={`rounded-lg border p-2.5 text-[12px] ${
            notice.kind === "success"
              ? "border-xyne-success-fg/30 bg-xyne-success-bg text-xyne-success-fg"
              : "border-xyne-error-fg/30 bg-xyne-error-bg text-xyne-error-fg"
          }`}>
            {notice.text}
          </div>
        </div>
      )}

      <MemoryTabV2 key={refreshKey} agentSlug={agentSlug} canDelete={canDelete} />

      <Dialog
        open={showClearConfirm}
        onOpenChange={(open) => {
          if (clearing) return;
          setShowClearConfirm(open);
          if (!open) setConfirmation("");
        }}
        title="Clear all memories?"
        description="This permanently deletes all memories for this agent and rejects its pending and approved review entries. Backfill can re-seed memories afterwards."
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowClearConfirm(false)} disabled={clearing}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void clearAllMemories()}
              disabled={clearing || confirmation !== agentSlug}
              leadingIcon={clearing ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            >
              {clearing ? "Clearing…" : "Clear all memories"}
            </Button>
          </>
        }
      >
        <label className="block text-[12px] text-xyne-fg-secondary">
          Type <span className="font-mono font-semibold text-xyne-fg-primary">{agentSlug}</span> to confirm
          <input
            autoFocus
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={clearing}
            className="mt-2 w-full rounded-lg border border-xyne-border bg-xyne-surface-subtle px-3 py-2 text-[13px] text-xyne-fg-primary focus:border-xyne-border-focus focus:outline-none focus:shadow-[var(--comp-focus-ring)] disabled:opacity-50"
          />
        </label>
      </Dialog>
    </>
  );
}
