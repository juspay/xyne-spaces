import { useState, useEffect } from "react";
import { ShieldCheckIcon } from "@phosphor-icons/react";
import { updateDigitalTwinSettings } from "../../../lib/api";
import { Switch } from "../ui/Switch";

interface MemoryApprovalCardProps {
  userId: string;
  approvalMode: string;
  minScore: number;
  /** Called after a successful save so the parent can refetch status. */
  onSaved: () => void;
}

// Mirrors MIN/MAX_AUTO_APPROVE_SCORE in digital-twin.ts (backend re-validates).
const MIN_SCORE = 0.7;
const MAX_SCORE = 1;
const SCORE_STEP = 0.05;

/**
 * Inline, self-saving auto-approval control for the Digital Twin page's right
 * rail. Flipping the switch persists immediately; the slider commits on release.
 * Optimistic — reverts to the server value if the PATCH fails.
 */
export function MemoryApprovalCard({
  userId,
  approvalMode,
  minScore,
  onSaved,
}: MemoryApprovalCardProps) {
  const [auto, setAuto] = useState(approvalMode === "auto");
  const [score, setScore] = useState(minScore);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Re-sync when the parent refetches (e.g. after another save).
  useEffect(() => {
    setAuto(approvalMode === "auto");
    setScore(minScore);
  }, [approvalMode, minScore]);

  async function persist(nextAuto: boolean, nextScore: number) {
    setSaving(true);
    setErr(null);
    try {
      await updateDigitalTwinSettings(userId, {
        memoryApprovalMode: nextAuto ? "auto" : "manual",
        ...(nextAuto ? { memoryAutoApproveMinScore: nextScore } : {}),
      });
      onSaved();
    } catch (e) {
      // Revert optimistic state to whatever the server last confirmed.
      setAuto(approvalMode === "auto");
      setScore(minScore);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function handleToggle(v: boolean) {
    setAuto(v);
    persist(v, score);
  }

  function commitScore() {
    if (auto && score !== minScore) persist(true, score);
  }

  return (
    <div className="rounded-xl border border-xyne-border bg-xyne-surface p-[14px]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-[6px]">
            <ShieldCheckIcon size={14} weight="duotone" className="text-xyne-brand" />
            <p className="text-[12px] font-semibold text-xyne-fg-primary">Memory approval</p>
          </div>
          <p className="mt-[4px] text-[11px] leading-relaxed text-xyne-fg-tertiary">
            {auto
              ? "High-confidence memories are saved automatically. Lower-confidence ones still wait for your review."
              : "Every memory waits in your review queue until you approve it."}
          </p>
        </div>
        <Switch checked={auto} onChange={handleToggle} disabled={saving} />
      </div>

      {auto && (
        <div className="mt-[12px]">
          <div className="mb-[4px] flex items-center justify-between text-[11px]">
            <span className="text-xyne-fg-tertiary">Auto-approve at or above</span>
            <span className="font-mono text-xyne-fg-primary">{score.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min={MIN_SCORE}
            max={MAX_SCORE}
            step={SCORE_STEP}
            value={score}
            disabled={saving}
            onChange={(e) => setScore(Number(e.target.value))}
            onMouseUp={commitScore}
            onTouchEnd={commitScore}
            onKeyUp={commitScore}
            className="w-full accent-xyne-brand"
          />
          <div className="mt-[2px] flex justify-between text-[10px] text-xyne-fg-tertiary">
            <span>{MIN_SCORE.toFixed(2)} · more memories</span>
            <span>{MAX_SCORE.toFixed(2)} · only the surest</span>
          </div>
        </div>
      )}

      {err && (
        <p className="mt-[8px] text-[11px] text-xyne-error-fg">{err}</p>
      )}
    </div>
  );
}
