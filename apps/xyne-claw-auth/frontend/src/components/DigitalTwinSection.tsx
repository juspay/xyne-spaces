/**
 * Digital Twin section — top-of-dashboard banner + modals for enable,
 * cluster review, and .md upload.
 *
 * Three banner states:
 *   1. Off  — Enable CTA. Shows the EnableModal.
 *   2. On / building — backfill in progress, shows per-source progress bars.
 *   3. On / steady — shows pending review count + Review CTA. Shows the
 *      ClusterDrawer.
 *
 * All endpoints under `/claw/api/v1/digital-twin/*`. Per-user scoped — the
 * x-user-id header is the privacy boundary (set by the api helper).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import {
  approveDigitalTwinCluster,
  disableDigitalTwin,
  enableDigitalTwin,
  getDigitalTwinCluster,
  getDigitalTwinEstimate,
  getDigitalTwinStatus,
  listDigitalTwinClusters,
  patchDigitalTwinCandidate,
  updateDigitalTwinSettings,
  uploadDigitalTwinMd,
  type DigitalTwinCandidate,
  type DigitalTwinClusterPreview,
  type DigitalTwinEstimate,
  type DigitalTwinStatus,
} from "../lib/api";

// ─── Info-icon tooltip ────────────────────────────────────────────────
// Small (i) badge that reveals an explanation on hover. Used liberally on
// the Twin page so users can self-serve the "what does this button do?"
// questions without me writing a help doc.
function InfoIcon({ text, size = 12 }: { text: string; size?: number }) {
  return (
    <span className="group relative inline-flex items-center align-middle">
      <Info
        size={size}
        className="ml-1 text-zinc-500 hover:text-zinc-300 cursor-help"
        aria-label={text}
      />
      <span className="pointer-events-none invisible absolute left-1/2 top-full z-50 mt-1 w-64 -translate-x-1/2 rounded border border-zinc-700 bg-zinc-900 p-2 text-[11px] font-normal leading-snug text-zinc-200 shadow-lg group-hover:visible">
        {text}
      </span>
    </span>
  );
}

interface Props {
  userId: string;
}

const SUBSYSTEM_LABELS: Record<string, { label: string; emoji: string; description: string }> = {
  style: { label: "Communication style", emoji: "💬", description: "How you write — tone, formatting, reply patterns" },
  expertise: { label: "Expertise", emoji: "🎯", description: "Domain knowledge and areas you're deep in" },
  projects: { label: "Projects", emoji: "🚀", description: "Ongoing work and current focus" },
  relationships: { label: "Relationships", emoji: "👥", description: "Collaborators, manager, key stakeholders" },
  preferences: { label: "Preferences", emoji: "⚙️", description: "Tools, workflow, formatting conventions" },
  decisions: { label: "Decisions", emoji: "🧭", description: "Captured judgment calls" },
  context: { label: "Context", emoji: "📍", description: "Identity, role, tenure, team" },
  docs: { label: "Documents", emoji: "📄", description: "References to your authored canvases and uploaded .md files" },
};

export function DigitalTwinSection({ userId }: Props) {
  const [status, setStatus] = useState<DigitalTwinStatus | null>(null);
  /** Modal mode for the range-picker modal:
   *   - "enable"   = first-time opt-in; flips digitalTwinEnabled=true
   *   - "backfill" = already enabled; just trigger a new backfill walk */
  const [rangeModal, setRangeModal] = useState<"enable" | "backfill" | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showDisable, setShowDisable] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await getDigitalTwinStatus(userId);
      setStatus(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll while backfill is running so progress bars update.
  const backfillRunning = useMemo(() => {
    if (!status?.backfillState) return false;
    return Object.values(status.backfillState).some((s) => !s.complete);
  }, [status]);

  useEffect(() => {
    if (!backfillRunning) return;
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [backfillRunning, refresh]);

  if (!status) {
    return (
      <div className="mb-6 rounded-xl border border-zinc-800 bg-zinc-950 px-5 py-4 text-sm text-zinc-500">
        Loading Digital Twin…
      </div>
    );
  }

  return (
    <>
      {/* ─── BANNER ────────────────────────────────────────────────── */}
      <div className="mb-6 rounded-xl border border-indigo-900/50 bg-gradient-to-r from-indigo-950/40 to-zinc-950 px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">🧠</span>
            <div>
              <div className="flex items-center text-sm font-semibold text-zinc-100">
                Digital Twin
                <InfoIcon
                  text="Your personal AI. When someone mentions you in Spaces, the Twin drafts a reply on your behalf, grounded in memories you approved. You stay in control: every memory passes through your review queue first, and you can disable + delete at any time."
                />
              </div>
              <div className="text-xs text-zinc-500">
                {!status.enabled && "Off — turn on to build a personal memory from your Spaces activity"}
                {status.enabled && backfillRunning && "Building your memory — first pass running"}
                {status.enabled && !backfillRunning && status.pendingCandidates > 0 &&
                  `${status.pendingCandidates} new memor${status.pendingCandidates === 1 ? "y" : "ies"} ready for your review`}
                {status.enabled && !backfillRunning && status.pendingCandidates === 0 &&
                  `On — ${status.approvedCandidates} approved memor${status.approvedCandidates === 1 ? "y" : "ies"}, nothing new today`}
              </div>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {!status.enabled && (
              <button
                onClick={() => setRangeModal("enable")}
                className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500"
              >
                Enable Digital Twin
              </button>
            )}
            {status.enabled && (
              <>
                <div className="flex items-center">
                  <button
                    onClick={() => setShowReview(true)}
                    disabled={status.pendingCandidates === 0}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Review {status.pendingCandidates > 0 && `(${status.pendingCandidates})`}
                  </button>
                  <InfoIcon text="Approve or reject candidate memories the curator extracted from your Spaces activity. Memories are grouped into clusters (style, projects, relationships, …). Approved memories become the Twin's source of truth." />
                </div>
                <div className="flex items-center">
                  <button
                    onClick={() => setRangeModal("backfill")}
                    disabled={backfillRunning}
                    className="rounded-lg border border-indigo-800 bg-zinc-900 px-3 py-1.5 text-sm text-indigo-300 hover:bg-indigo-950/30 disabled:opacity-40 disabled:cursor-not-allowed"
                    title={backfillRunning ? "Backfill already running" : "Pull additional historical activity"}
                  >
                    Backfill history
                  </button>
                  <InfoIcon text="Run another pass over your historical Spaces activity. Pick a date range; the curator processes messages, hosted calls, and canvases from that window and adds new candidate memories to your review queue." />
                </div>
                <div className="flex items-center">
                  <button
                    onClick={() => setShowUpload(true)}
                    className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
                  >
                    Upload .md
                  </button>
                  <InfoIcon text="Attach a markdown file (e.g. an 'about me', working preferences, project context). The curator extracts candidate memories from it and adds them under the 'Documents' cluster for your review." />
                </div>
                <div className="flex items-center">
                  <button
                    onClick={() => setShowSettings(true)}
                    className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800"
                  >
                    Settings
                  </button>
                  <InfoIcon text="Configure Twin behavior — e.g. add a custom signature/disclaimer appended to every reply your Twin sends on your behalf." />
                </div>
                <div className="flex items-center">
                  <button
                    onClick={() => setShowDisable(true)}
                    className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-200 hover:border-zinc-700"
                  >
                    Disable
                  </button>
                  <InfoIcon text="Pauses the Twin (no more recall, no nightly curation). Optionally delete every memory at the same time — irreversible. You can re-enable later." />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Backfill progress bars */}
        {status.enabled && backfillRunning && status.backfillState && (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(["messages", "calls", "canvases"] as const).map((source) => {
              const entry = status.backfillState![source];
              if (!entry) return null;
              const from = new Date(entry.from);
              const to = new Date(entry.to);
              const cursor = new Date(entry.cursor);
              const total = to.getTime() - from.getTime();
              const done = to.getTime() - cursor.getTime();
              const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((done / total) * 100))) : 100;
              return (
                <div key={source} className="rounded-md border border-indigo-900/40 bg-zinc-950 p-2 text-xs">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-zinc-400">{source}</span>
                    <span className="text-zinc-500">{entry.complete ? "✓" : `${pct}%`}</span>
                  </div>
                  <div className="h-1 rounded bg-zinc-900">
                    <div className="h-1 rounded bg-indigo-500" style={{ width: `${entry.complete ? 100 : pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {error && (
          <div className="mt-3 text-xs text-red-400">
            {error} <button onClick={() => setError(null)} className="ml-2 underline">dismiss</button>
          </div>
        )}
      </div>

      {/* ─── MODALS ────────────────────────────────────────────────── */}
      {rangeModal && (
        <EnableModal
          userId={userId}
          mode={rangeModal}
          onClose={() => setRangeModal(null)}
          onEnabled={() => { setRangeModal(null); refresh(); }}
        />
      )}
      {showReview && (
        <ReviewDrawer userId={userId} onClose={() => { setShowReview(false); refresh(); }} />
      )}
      {showUpload && (
        <UploadModal userId={userId} onClose={() => setShowUpload(false)} onUploaded={() => { setShowUpload(false); refresh(); }} />
      )}
      {showDisable && (
        <DisableModal userId={userId} onClose={() => setShowDisable(false)} onDisabled={() => { setShowDisable(false); refresh(); }} />
      )}
      {showSettings && (
        <SettingsModal
          userId={userId}
          initialSuffix={status.responseSuffix}
          onClose={() => setShowSettings(false)}
          onSaved={() => { setShowSettings(false); refresh(); }}
        />
      )}
    </>
  );
}

// ─── ENABLE / BACKFILL MODAL ──────────────────────────────────────────
//
// One modal serves two flows because they're 95% the same form:
//   - mode="enable":   first-time opt-in. "Skip backfill" preset offered;
//                      submit flips digitalTwinEnabled=true.
//   - mode="backfill": already enabled, user wants another pass over their
//                      history (different/extended range). "Skip" is hidden;
//                      submit re-calls /enable which is idempotent on the
//                      flag and overwrites backfillState + re-enqueues jobs.

interface RangePreset { label: string; months: number | null }

const RANGE_PRESETS_ENABLE: RangePreset[] = [
  { label: "Skip backfill — start from today", months: null },
  { label: "Last 3 months", months: 3 },
  { label: "Last 6 months", months: 6 },
  { label: "Last 12 months", months: 12 },
];

const RANGE_PRESETS_BACKFILL: RangePreset[] = [
  { label: "Last 3 months", months: 3 },
  { label: "Last 6 months", months: 6 },
  { label: "Last 12 months", months: 12 },
  { label: "Last 24 months", months: 24 },
];

function EnableModal({
  userId,
  mode,
  onClose,
  onEnabled,
}: {
  userId: string;
  mode: "enable" | "backfill";
  onClose: () => void;
  onEnabled: () => void;
}) {
  const presets = mode === "enable" ? RANGE_PRESETS_ENABLE : RANGE_PRESETS_BACKFILL;
  // In enable mode the "Skip backfill" option is index 0, default to 6mo (idx 2).
  // In backfill mode there is no skip, so default to 6mo (idx 1).
  const [presetIdx, setPresetIdx] = useState(mode === "enable" ? 2 : 1);
  const [estimate, setEstimate] = useState<DigitalTwinEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rangeFromPreset = useCallback(() => {
    const preset = presets[presetIdx];
    if (!preset || preset.months === null) return null;
    const to = new Date();
    const from = new Date(to);
    from.setMonth(from.getMonth() - preset.months);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }, [presetIdx, presets]);

  // Live estimate when preset changes.
  useEffect(() => {
    const range = rangeFromPreset();
    if (!range) {
      setEstimate(null);
      return;
    }
    setEstimating(true);
    getDigitalTwinEstimate(userId, range.from, range.to)
      .then((e) => setEstimate(e))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setEstimating(false));
  }, [presetIdx, userId, rangeFromPreset]);

  async function submit() {
    setEnabling(true);
    setErr(null);
    try {
      const range = rangeFromPreset();
      await enableDigitalTwin(userId, range);
      onEnabled();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setEnabling(false);
    }
  }

  return (
    <Modal onClose={onClose} title={mode === "enable" ? "Enable Digital Twin" : "Backfill history"}>
      <p className="mb-4 text-sm text-zinc-400">
        {mode === "enable"
          ? "Your Twin learns from your own Spaces activity — public messages, calls you hosted, canvases you authored. Nothing in DMs or private channels is read."
          : "Run another pass over your Spaces history. Pulls public messages, hosted calls, and authored canvases within the selected window and adds candidate memories to your review queue."}
      </p>

      <div className="space-y-2">
        <label className="flex items-center text-xs uppercase tracking-wide text-zinc-500">
          How far back to look
          <InfoIcon text="The curator walks your Spaces history newest → oldest in this window. Longer ranges mean more candidate memories but a larger initial LLM bill. You can run additional backfills later." />
        </label>
        {presets.map((preset, i) => (
          <label key={i} className={`flex cursor-pointer items-center gap-2 rounded border p-2 ${presetIdx === i ? "border-indigo-700 bg-indigo-950/30" : "border-zinc-800 hover:border-zinc-700"}`}>
            <input
              type="radio"
              checked={presetIdx === i}
              onChange={() => setPresetIdx(i)}
              className="text-indigo-500"
            />
            <span className="text-sm text-zinc-200">{preset.label}</span>
          </label>
        ))}
      </div>

      {estimate && (
        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs">
          <div className="mb-1 flex items-center text-zinc-500">
            Estimated:
            <InfoIcon text="Cheap row-count from Spaces (no LLM calls). Actual candidate count and cost may shift ±50% based on how dense your activity is. The Twin only spends LLM budget on windows that contain records." />
          </div>
          <div className="grid grid-cols-3 gap-2 text-zinc-300">
            <div><span className="text-zinc-500">{estimate.messages}</span> messages</div>
            <div><span className="text-zinc-500">{estimate.calls}</span> calls</div>
            <div><span className="text-zinc-500">{estimate.canvases}</span> canvases</div>
          </div>
          <div className="mt-2 text-zinc-500">
            ~{estimate.estCandidates} candidate memor{estimate.estCandidates === 1 ? "y" : "ies"} · ~${estimate.estCostUSD.toFixed(2)} LLM cost (charged to org)
          </div>
        </div>
      )}
      {estimating && !estimate && <div className="mt-4 text-xs text-zinc-500">Estimating…</div>}

      {err && <div className="mt-3 rounded border border-red-900 bg-red-950/30 p-2 text-xs text-red-300">{err}</div>}

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded border border-zinc-700 px-4 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={enabling}
          className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {enabling
            ? (mode === "enable" ? "Enabling…" : "Starting backfill…")
            : (mode === "enable" ? "Enable & Start" : "Start backfill")}
        </button>
      </div>
    </Modal>
  );
}

// ─── REVIEW DRAWER (clusters) ─────────────────────────────────────────

function ReviewDrawer({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [clusters, setClusters] = useState<DigitalTwinClusterPreview[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listDigitalTwinClusters(userId)
      .then((d) => setClusters(d.clusters))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <Modal onClose={onClose} title="Review memories" wide>
      {err && <div className="mb-3 rounded border border-red-900 bg-red-950/30 p-2 text-xs text-red-300">{err}</div>}

      {!clusters && <div className="text-sm text-zinc-500">Loading…</div>}

      {clusters && clusters.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-800 py-10 text-center text-sm text-zinc-500">
          Nothing pending. The daily curator will add new candidates after 21:00 UTC each night.
        </div>
      )}

      {!active && clusters && clusters.length > 0 && (
        <div className="space-y-2">
          {clusters.map((c) => {
            const info = SUBSYSTEM_LABELS[c.subsystem] ?? { label: c.subsystem, emoji: "•", description: "" };
            return (
              <button
                key={c.subsystem}
                onClick={() => setActive(c.subsystem)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-left hover:border-indigo-800 hover:bg-indigo-950/20"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{info.emoji}</span>
                    <div>
                      <div className="text-sm font-medium text-zinc-100">{info.label}</div>
                      <div className="text-xs text-zinc-500">{info.description}</div>
                    </div>
                  </div>
                  <span className="rounded-full bg-indigo-900/50 px-2 py-0.5 text-xs text-indigo-200">
                    {c.pending} pending
                  </span>
                </div>
                {c.top3.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-zinc-400">
                    {c.top3.map((t) => (
                      <li key={t.id} className="truncate">• {t.text}</li>
                    ))}
                  </ul>
                )}
              </button>
            );
          })}
        </div>
      )}

      {active && (
        <ClusterDetail
          userId={userId}
          subsystem={active}
          onBack={() => { setActive(null); refresh(); }}
        />
      )}
    </Modal>
  );
}

function ClusterDetail({ userId, subsystem, onBack }: { userId: string; subsystem: string; onBack: () => void }) {
  const [candidates, setCandidates] = useState<DigitalTwinCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(() => {
    getDigitalTwinCluster(userId, subsystem)
      .then((d) => {
        setCandidates(d.candidates);
        setSelected(new Set(d.candidates.map((c) => c.id)));
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [userId, subsystem]);

  useEffect(() => { refresh(); }, [refresh]);

  const info = SUBSYSTEM_LABELS[subsystem] ?? { label: subsystem, emoji: "•", description: "" };

  async function approveAll() {
    setBusy(true);
    setErr(null);
    try {
      await approveDigitalTwinCluster(userId, subsystem);
      onBack();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function approveSelected() {
    if (selected.size === 0) return;
    setBusy(true);
    setErr(null);
    try {
      await approveDigitalTwinCluster(userId, subsystem, Array.from(selected));
      onBack();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function rejectOne(id: string) {
    try {
      await patchDigitalTwinCandidate(userId, id, { status: "rejected" });
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveEdit(id: string) {
    try {
      await patchDigitalTwinCandidate(userId, id, { editedText: editText });
      setEditing(null);
      setEditText("");
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={onBack} className="text-xs text-zinc-500 hover:text-zinc-200">← back</button>
        <span className="text-lg">{info.emoji}</span>
        <span className="text-sm font-medium text-zinc-100">{info.label}</span>
        <span className="text-xs text-zinc-500">— {info.description}</span>
      </div>

      {err && <div className="mb-3 rounded border border-red-900 bg-red-950/30 p-2 text-xs text-red-300">{err}</div>}

      {!candidates && <div className="text-sm text-zinc-500">Loading…</div>}

      {candidates && candidates.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-800 py-8 text-center text-sm text-zinc-500">
          No pending candidates in this cluster.
        </div>
      )}

      {candidates && candidates.length > 0 && (
        <>
          <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
            <button onClick={() => setSelected(new Set(candidates.map((c) => c.id)))} className="underline hover:text-zinc-200">Select all</button>
            <span>·</span>
            <button onClick={() => setSelected(new Set())} className="underline hover:text-zinc-200">Select none</button>
            <span className="ml-auto">{selected.size} of {candidates.length} selected</span>
          </div>

          <div className="space-y-2">
            {candidates.map((c) => {
              const isEditing = editing === c.id;
              return (
                <div key={c.id} className={`rounded-lg border p-3 text-sm ${selected.has(c.id) ? "border-indigo-800 bg-indigo-950/20" : "border-zinc-800 bg-zinc-950"}`}>
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={(e) => {
                        const s = new Set(selected);
                        if (e.target.checked) s.add(c.id); else s.delete(c.id);
                        setSelected(s);
                      }}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      {!isEditing && (
                        <div className="text-zinc-200">{c.editedText ?? c.text}</div>
                      )}
                      {isEditing && (
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          className="h-24 w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-100"
                        />
                      )}
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
                        <span>signal {c.signalScore.toFixed(2)}</span>
                        <span>·</span>
                        <span>{c.sourceRefs.length} source{c.sourceRefs.length === 1 ? "" : "s"}</span>
                        <span>·</span>
                        <span className="font-mono">{c.source.slice(0, 32)}{c.source.length > 32 ? "…" : ""}</span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      {!isEditing && (
                        <>
                          <button
                            onClick={() => { setEditing(c.id); setEditText(c.editedText ?? c.text); }}
                            className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => rejectOne(c.id)}
                            className="rounded border border-red-900 px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-950/40"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {isEditing && (
                        <>
                          <button onClick={() => saveEdit(c.id)} className="rounded bg-indigo-600 px-2 py-0.5 text-[11px] text-white hover:bg-indigo-500">Save</button>
                          <button onClick={() => { setEditing(null); setEditText(""); }} className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800">Cancel</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex gap-2 border-t border-zinc-800 pt-3">
            <button
              onClick={approveSelected}
              disabled={busy || selected.size === 0}
              className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              ✅ Approve selected ({selected.size})
            </button>
            <button
              onClick={approveAll}
              disabled={busy}
              className="rounded border border-zinc-700 bg-zinc-900 px-4 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
            >
              Approve all
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── UPLOAD MODAL ────────────────────────────────────────────────────

function UploadModal({ userId, onClose, onUploaded }: { userId: string; onClose: () => void; onUploaded: () => void }) {
  const [filename, setFilename] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    file.text().then((t) => setContent(t)).catch((err) => setErr(err.message));
  }

  async function submit() {
    if (!filename || !content) {
      setErr("File and content required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await uploadDigitalTwinMd(userId, filename, content);
      onUploaded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Upload .md to your Digital Twin">
      <p className="mb-3 text-xs text-zinc-400">
        The file is run through the same curator as your Spaces activity; you'll see the resulting
        candidates in your review queue under the "Documents" cluster.
      </p>

      <input
        type="file"
        accept=".md,.markdown,text/markdown"
        onChange={handleFile}
        className="mb-3 block w-full text-xs text-zinc-400 file:mr-3 file:rounded file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-xs file:text-zinc-100 hover:file:bg-zinc-700"
      />

      {filename && (
        <div className="mb-2 text-xs text-zinc-500">
          <span className="font-mono">{filename}</span> · {content.length.toLocaleString()} chars
        </div>
      )}

      {content && (
        <textarea
          readOnly
          value={content.slice(0, 2000) + (content.length > 2000 ? "\n\n…(truncated preview)" : "")}
          className="h-40 w-full rounded border border-zinc-800 bg-zinc-950 p-2 text-xs font-mono text-zinc-400"
        />
      )}

      {err && <div className="mt-2 rounded border border-red-900 bg-red-950/30 p-2 text-xs text-red-300">{err}</div>}

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded border border-zinc-700 px-4 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800">Cancel</button>
        <button
          onClick={submit}
          disabled={busy || !filename || !content}
          className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>
    </Modal>
  );
}

// ─── DISABLE MODAL ───────────────────────────────────────────────────

function DisableModal({ userId, onClose, onDisabled }: { userId: string; onClose: () => void; onDisabled: () => void }) {
  const [deleteMemories, setDeleteMemories] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await disableDigitalTwin(userId, deleteMemories);
      onDisabled();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Disable Digital Twin">
      <p className="mb-3 text-sm text-zinc-300">
        Pause the curator and stop recall through the Twin agent. You can re-enable later.
      </p>
      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-red-900/50 bg-red-950/10 p-3">
        <input
          type="checkbox"
          checked={deleteMemories}
          onChange={(e) => setDeleteMemories(e.target.checked)}
          className="mt-0.5"
        />
        <div className="text-sm text-red-300">
          <div className="font-medium">Also delete all memories</div>
          <div className="mt-0.5 text-xs text-red-400/80">
            Removes every approved memory from Hindsight and every pending/rejected candidate from the database. Irreversible.
          </div>
        </div>
      </label>

      {err && <div className="mt-3 rounded border border-red-900 bg-red-950/30 p-2 text-xs text-red-300">{err}</div>}

      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded border border-zinc-700 px-4 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800">Cancel</button>
        <button
          onClick={submit}
          disabled={busy}
          className={`rounded px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${deleteMemories ? "bg-red-600 hover:bg-red-500" : "bg-zinc-600 hover:bg-zinc-500"}`}
        >
          {busy ? "Disabling…" : deleteMemories ? "Disable & delete all" : "Disable"}
        </button>
      </div>
    </Modal>
  );
}

// ─── SETTINGS MODAL ──────────────────────────────────────────────────
//
// V1 settings surface — just the response-suffix field. The backend
// PATCH /digital-twin/settings is generic enough to add more fields later
// (style flags, response language, etc.) without breaking the wire format.

const MAX_SUFFIX_LEN = 500;

function SettingsModal({
  userId,
  initialSuffix,
  onClose,
  onSaved,
}: {
  userId: string;
  initialSuffix: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [suffix, setSuffix] = useState(initialSuffix);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dirty = suffix.trim() !== initialSuffix.trim();

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      // Empty string clears the suffix server-side; the route normalizes it
      // to null. No client-side branching needed.
      await updateDigitalTwinSettings(userId, { responseSuffix: suffix });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Digital Twin settings">
      <div className="space-y-3">
        <div>
          <div className="mb-1 flex items-center text-xs font-medium uppercase tracking-wide text-zinc-400">
            Response suffix
            <InfoIcon text="Appended to the end of every reply your Twin sends on your behalf. Use it for a disclaimer ('Sent by my Digital Twin — may contain mistakes'), a contact line, or a signature. Leave blank to disable." />
          </div>
          <textarea
            value={suffix}
            onChange={(e) => setSuffix(e.target.value.slice(0, MAX_SUFFIX_LEN))}
            maxLength={MAX_SUFFIX_LEN}
            rows={4}
            placeholder="— Sent by my Digital Twin · may contain mistakes"
            className="w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-100 focus:border-indigo-700 focus:outline-none"
          />
          <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-500">
            <span>{suffix.length === 0 ? "No suffix — replies post as-is." : "Will appear at the end of every Twin reply."}</span>
            <span>{suffix.length} / {MAX_SUFFIX_LEN}</span>
          </div>
        </div>

        {suffix.trim().length > 0 && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs">
            <div className="mb-1 text-zinc-500">Preview:</div>
            <div className="whitespace-pre-wrap text-zinc-300">
              <span className="text-zinc-500">[your Twin's reply]</span>
              {"\n\n"}
              <span className="text-indigo-300">{suffix.trim()}</span>
            </div>
          </div>
        )}

        {err && <div className="rounded border border-red-900 bg-red-950/30 p-2 text-xs text-red-300">{err}</div>}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded border border-zinc-700 px-4 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

// ─── SHARED MODAL SHELL ──────────────────────────────────────────────

function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-20 overflow-y-auto">
      <div className={`w-full rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl ${wide ? "max-w-3xl" : "max-w-md"}`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
