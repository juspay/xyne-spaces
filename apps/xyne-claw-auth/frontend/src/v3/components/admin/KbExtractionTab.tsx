/**
 * Admin: which projects and channels feed the People-KB, and how far each has got.
 *
 * Two deliberate frictions, both because nothing in the stack can delete a KB
 * page — a mistake here can only be papered over, never undone:
 *
 *   - Private channels are off by default and say so in the UI.
 *   - Extraction is triggered explicitly, never on save.
 */
import { useCallback, useEffect, useState } from "react";
import { frontendConfig } from "../../../lib/config";

const API = `${frontendConfig.clawApiBaseUrl}/api/v1/kb`;

interface KbChannel {
  channelId: string;
  name: string;
  visibility: string;
  included: boolean;
  includedBy: string | null;
  /** null means this channel has never been extracted. */
  backfillFrom: string | null;
  includedAt: string | null;
  extractedThrough: string | null;
  lastRunAt: string | null;
  lastError: string | null;
}

/**
 * One row per job attempt, whatever the stage.
 *
 * Extract, merge and reconcile share this shape — `subject` is what the run
 * covered in its own terms (a channel name, a findings day, an entity path) and
 * `metrics` holds whatever counters that stage produces.
 */
interface KbRun {
  id: string;
  kind: "EXTRACT" | "MERGE" | "RECONCILE";
  projectCode: string;
  subject: string;
  channelId: string | null;
  windowFrom: string | null;
  windowTo: string | null;
  metrics: Record<string, number> | null;
  summary: string | null;
  status: string;
  error: string | null;
  startedAt: string;
}

interface KbProject {
  projectId: string;
  projectCode: string;
  projectName: string;
  collectionId: string;
  extractAgentSlug: string | null;
  mergeAgentSlug: string | null;
  reconcileAgentSlug: string | null;
  enabled: boolean;
  enabledBy: string | null;
  enabledAt: string | null;
  channels: KbChannel[];
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = (await response.json()) as { success: boolean; data?: T; error?: string };
  if (!response.ok || !body.success) throw new Error(body.error ?? `request failed (${response.status})`);
  return body.data as T;
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

/**
 * How far a backfill has got, as "start -> position" plus days remaining.
 *
 * `extractedThrough` on its own cannot tell "nearly done" from "barely
 * started" — that needs the origin the walk began from.
 */
function progress(channel: KbChannel): { label: string; remaining: number | null } {
  const start = channel.backfillFrom ?? channel.includedAt;
  if (!start) return { label: "—", remaining: null };
  if (!channel.extractedThrough) return { label: `${day(start)} -> not started`, remaining: null };

  const doneTo = new Date(channel.extractedThrough).getTime();
  const remainingDays = Math.max(0, Math.ceil((Date.now() - doneTo) / 86_400_000));
  return { label: `${day(start)} -> ${day(channel.extractedThrough)}`, remaining: remainingDays };
}

/** "2 hours ago" reads better than a timestamp when the question is "is it caught up?". */
function relative(iso: string | null): string {
  if (!iso) return "never";
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const inputClass =
  "w-full rounded border border-xyne-border-subtle bg-xyne-surface px-2 py-1 text-[11px] text-xyne-fg-primary";

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-xyne-fg-tertiary">{label}</span>
      <input className={inputClass} value={value} placeholder={placeholder}
             onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function KbExtractionTab() {
  const [projects, setProjects] = useState<KbProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /* Ids are typed in rather than picked: Spaces has no list-projects endpoint,
     and an admin adding a project already has the id to hand. A picker can
     replace this without changing anything below. */
  const [runs, setRuns] = useState<KbRun[]>([]);
  const [mergeRuns, setMergeRuns] = useState<KbRun[]>([]);
  const [reconcileRuns, setReconcileRuns] = useState<KbRun[]>([]);
  const [showRuns, setShowRuns] = useState(false);
  const [showReconcile, setShowReconcile] = useState(false);
  const [showAddProject, setShowAddProject] = useState(false);
  const [newProject, setNewProject] = useState({
    projectId: "", projectCode: "", projectName: "", workspaceId: "", collectionId: "",
    extractAgentSlug: "", mergeAgentSlug: "", reconcileAgentSlug: "",
  });
  const [addChannelTo, setAddChannelTo] = useState<string | null>(null);
  const [newChannel, setNewChannel] = useState({
    channelId: "", name: "", visibility: "PUBLIC", backfillFrom: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // One request per stage, not one split client-side: a single backfill
      // night is well over 150 EXTRACT rows, and a shared limit meant the merge
      // and reconcile panels rendered "No merges yet" — the failure they exist
      // to surface, reported as its opposite — precisely when the pipeline was
      // busiest.
      const [p, extract, merge, reconcile] = await Promise.all([
        api<KbProject[]>("/projects"),
        // Non-fatal: the run history is diagnostic, not required to operate.
        api<KbRun[]>("/runs?kind=EXTRACT&limit=150").catch(() => [] as KbRun[]),
        api<KbRun[]>("/runs?kind=MERGE&limit=60").catch(() => [] as KbRun[]),
        api<KbRun[]>("/runs?kind=RECONCILE&limit=60").catch(() => [] as KbRun[]),
      ]);
      setProjects(p);
      setRuns(extract);
      setMergeRuns(merge);
      setReconcileRuns(reconcile);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* Runs are asynchronous and take minutes. The screen shows the state as of
     the last load — deliberately not polled, since a background timer running
     for the length of a backfill is a lot of load for numbers nobody is
     watching. Refresh when you want to know.

     Fetched per kind rather than split from one list: the stages produce wildly
     different row counts, so a shared limit lets extraction crowd the other two
     out of the response entirely. */
  const inFlight = [...runs, ...mergeRuns, ...reconcileRuns].some((r) => r.status === "RUNNING");

  const toggleChannel = async (project: KbProject, channel: KbChannel) => {
    setBusy(channel.channelId);
    try {
      await api("/channels", {
        method: "POST",
        body: JSON.stringify({
          channelId: channel.channelId,
          projectId: project.projectId,
          name: channel.name,
          visibility: channel.visibility,
          included: !channel.included,
        }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const addProject = async () => {
    setBusy("add-project");
    try {
      await api("/projects", { method: "POST", body: JSON.stringify({ ...newProject, enabled: true }) });
      setShowAddProject(false);
      setNewProject({
        projectId: "", projectCode: "", projectName: "", workspaceId: "", collectionId: "",
        extractAgentSlug: "", mergeAgentSlug: "", reconcileAgentSlug: "",
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const addChannel = async (projectId: string) => {
    setBusy("add-channel");
    try {
      await api("/channels", {
        method: "POST",
        body: JSON.stringify({
          ...newChannel,
          projectId,
          scopeType: "DEFAULT",
          included: true,
          // Blank means "from now" — the safe default, since backfilling a
          // channel's whole history costs real model spend.
          ...(newChannel.backfillFrom ? { backfillFrom: new Date(newChannel.backfillFrom).toISOString() } : {}),
        }),
      });
      setAddChannelTo(null);
      setNewChannel({ channelId: "", name: "", visibility: "PUBLIC", backfillFrom: "" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const extractChannel = async (channel: KbChannel) => {
    setBusy(channel.channelId);
    try {
      await api(`/channels/${channel.channelId}/extract`, { method: "POST" });
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const backfillChannel = async (channel: KbChannel) => {
    const from = window.prompt(
      `Re-extract ${channel.name} from which date? (YYYY-MM-DD)\n\n` +
        `This clears its progress and re-reads everything from that date, which costs ` +
        `model spend on ground already covered. Findings dedupe on merge.`,
      "2026-04-13",
    );
    if (!from) return;

    setBusy(channel.channelId);
    try {
      await api(`/channels/${channel.channelId}/backfill`, {
        method: "POST",
        body: JSON.stringify({ from: new Date(from).toISOString() }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const removeChannel = async (channel: KbChannel) => {
    if (!window.confirm(
      `Remove ${channel.name} from extraction?\n\n` +
        `Its progress and run history are discarded. Pages already written to the KB stay — ` +
        `nothing can delete those. To pause instead, un-tick Included.`,
    )) return;

    setBusy(channel.channelId);
    try {
      await api(`/channels/${channel.channelId}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const runMerge = async (project: KbProject) => {
    setBusy(`merge-${project.projectId}`);
    try {
      await api(`/merge/${project.projectCode}`, { method: "POST" });
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  /* Rewrites pages the merge already wrote, and a fold cannot be undone — so it
     asks first. Everything else on this screen only adds. */
  const runReconcile = async (project: KbProject) => {
    const ok = window.confirm(
      `Reconcile ${project.projectCode}?\n\n` +
        `This re-reads every page in the KB and rewrites what the evidence does not ` +
        `support — demoting people, removing uncorroborated claims, and folding ` +
        `duplicate entities into redirect stubs.\n\nFolds cannot be undone.`,
    );
    if (!ok) return;

    setBusy(`reconcile-${project.projectId}`);
    try {
      await api(`/reconcile/${project.projectCode}`, { method: "POST" });
      setError(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const runExtraction = async (project: KbProject) => {
    setBusy(project.projectId);
    try {
      await api(`/extract/${project.projectCode}`, { method: "POST" });
      setError(null);
      // Nothing to show yet — the run is asynchronous and takes minutes.
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <p className="text-[12px] text-xyne-fg-tertiary">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      {inFlight && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-500">
          Working — {runs.filter((r) => r.status === "RUNNING").length} extraction and{" "}
          {mergeRuns.filter((r) => r.status === "RUNNING").length} merge window(s) in progress.
          Use Refresh to see progress.
        </p>
      )}

      {error && (
        <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-400">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => void load()} disabled={loading}
                className="rounded-md border border-xyne-border-subtle px-3 py-1.5 text-[11px] text-xyne-fg-secondary hover:bg-xyne-surface disabled:opacity-50">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div>
        {!showAddProject ? (
          <button type="button" onClick={() => setShowAddProject(true)}
                  className="rounded-md border border-xyne-border-subtle px-3 py-1.5 text-[11px] text-xyne-fg-secondary hover:bg-xyne-surface">
            + Add project
          </button>
        ) : (
          <div className="rounded-lg border border-xyne-border-subtle bg-xyne-surface-muted p-4">
            <h4 className="mb-3 text-[12px] font-medium text-xyne-fg-primary">Enable a project</h4>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Project ID" value={newProject.projectId} placeholder="cmsebr53j..."
                     onChange={(v) => setNewProject((p) => ({ ...p, projectId: v }))} />
              <Field label="Code" value={newProject.projectCode} placeholder="XYNE"
                     onChange={(v) => setNewProject((p) => ({ ...p, projectCode: v }))} />
              <Field label="Name" value={newProject.projectName} placeholder="Xyne-Space"
                     onChange={(v) => setNewProject((p) => ({ ...p, projectName: v }))} />
              <Field label="Workspace ID" value={newProject.workspaceId} placeholder="cmsebr50u..."
                     onChange={(v) => setNewProject((p) => ({ ...p, workspaceId: v }))} />
              <Field label="Collection ID (the KB)" value={newProject.collectionId} placeholder="col_..."
                     onChange={(v) => setNewProject((p) => ({ ...p, collectionId: v }))} />
              <Field label="Extractor agent (blank = kb-extract)" value={newProject.extractAgentSlug}
                     placeholder="kb-extract"
                     onChange={(v) => setNewProject((p) => ({ ...p, extractAgentSlug: v }))} />
              <Field label="Merge agent (blank = kb-merge)" value={newProject.mergeAgentSlug}
                     placeholder="kb-merge"
                     onChange={(v) => setNewProject((p) => ({ ...p, mergeAgentSlug: v }))} />
              <Field label="Reconcile agent (blank = kb-reconcile)" value={newProject.reconcileAgentSlug}
                     placeholder="kb-reconcile"
                     onChange={(v) => setNewProject((p) => ({ ...p, reconcileAgentSlug: v }))} />
            </div>
            <p className="mt-2 text-[10px] text-xyne-fg-tertiary">
              The code becomes the KB path segment (projects/&lt;CODE&gt;/) and cannot be changed later —
              pages cannot be renamed or moved.
            </p>
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={busy === "add-project" || !newProject.projectId || !newProject.projectCode || !newProject.workspaceId || !newProject.collectionId}
                      onClick={() => void addProject()}
                      className="rounded-md bg-xyne-accent px-3 py-1.5 text-[11px] text-white disabled:opacity-50">
                {busy === "add-project" ? "Saving…" : "Enable"}
              </button>
              <button type="button" onClick={() => setShowAddProject(false)}
                      className="rounded-md border border-xyne-border-subtle px-3 py-1.5 text-[11px] text-xyne-fg-secondary">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {projects.length === 0 && (
        <p className="text-[12px] text-xyne-fg-tertiary">
          No projects opted in. A project must be enabled before any of its channels are extracted.
        </p>
      )}

      {projects.map((project) => (
        <section
          key={project.projectId}
          className="rounded-lg border border-xyne-border-subtle bg-xyne-surface-muted p-4"
        >
          <header className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-[13px] font-medium text-xyne-fg-primary">
                {project.projectCode}
                <span className="ml-2 font-normal text-xyne-fg-tertiary">{project.projectName}</span>
              </h3>
              <p className="mt-0.5 text-[11px] text-xyne-fg-tertiary">
                KB → {project.collectionId} · agents: {project.extractAgentSlug ?? "kb-extract"} /{" "}
                {project.mergeAgentSlug ?? "kb-merge"} / {project.reconcileAgentSlug ?? "kb-reconcile"}
                {project.enabledBy && ` · enabled by ${project.enabledBy}`}
              </p>
            </div>

            <div className="flex gap-2">
            <button
              type="button"
              disabled={busy === project.projectId || !project.enabled}
              onClick={() => void runExtraction(project)}
              className="rounded-md border border-xyne-border-subtle px-3 py-1.5 text-[11px] text-xyne-fg-secondary hover:bg-xyne-surface disabled:opacity-50"
            >
              {busy === project.projectId ? "Starting…" : "Extract now"}
            </button>

            <button
              type="button"
              disabled={busy === `merge-${project.projectId}` || !project.enabled}
              onClick={() => void runMerge(project)}
              className="rounded-md border border-xyne-border-subtle px-3 py-1.5 text-[11px] text-xyne-fg-secondary hover:bg-xyne-surface disabled:opacity-50"
            >
              {busy === `merge-${project.projectId}` ? "Starting…" : "Merge now"}
            </button>

            <button
              type="button"
              disabled={busy === `reconcile-${project.projectId}` || !project.enabled}
              onClick={() => void runReconcile(project)}
              className="rounded-md border border-xyne-border-subtle px-3 py-1.5 text-[11px] text-xyne-fg-secondary hover:bg-xyne-surface disabled:opacity-50"
            >
              {busy === `reconcile-${project.projectId}` ? "Starting…" : "Reconcile"}
            </button>
            </div>
          </header>

          <table className="mt-3 w-full text-[11px]">
            <thead className="text-xyne-fg-tertiary">
              <tr className="text-left">
                <th className="pb-1 font-normal">Channel</th>
                <th className="pb-1 font-normal">Progress</th>
                <th className="pb-1 font-normal">Remaining</th>
                <th className="pb-1 font-normal">Last run</th>
                <th className="pb-1 font-normal">Included</th>
                <th className="pb-1 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {project.channels.map((channel) => (
                <tr key={channel.channelId} className="border-t border-xyne-border-subtle/50">
                  <td className="py-1.5 text-xyne-fg-secondary">
                    {channel.name}
                    {channel.visibility !== "PUBLIC" && (
                      <span className="ml-1.5 rounded bg-amber-500/15 px-1 text-[10px] text-amber-500">
                        private
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 font-mono text-[10px] text-xyne-fg-tertiary">
                    {progress(channel).label}
                  </td>
                  <td className="py-1.5 text-xyne-fg-tertiary">
                    {(() => {
                      const r = progress(channel).remaining;
                      if (r === null) return "—";
                      // Under a day means the walk has reached now; the nightly
                      // keeps it there.
                      return r <= 1 ? <span className="text-green-500">caught up</span> : `${r}d behind`;
                    })()}
                  </td>
                  <td className="py-1.5 text-xyne-fg-tertiary">
                    {channel.lastError ? (
                      <span className="text-red-400" title={channel.lastError}>
                        failed
                      </span>
                    ) : (
                      relative(channel.lastRunAt)
                    )}
                  </td>
                  <td className="py-1.5">
                    <input
                      type="checkbox"
                      checked={channel.included}
                      disabled={busy === channel.channelId}
                      onChange={() => void toggleChannel(project, channel)}
                    />
                  </td>
                  <td className="py-1.5 text-right">
                    <button type="button" disabled={busy === channel.channelId || !channel.included}
                            onClick={() => void extractChannel(channel)}
                            className="mr-2 text-xyne-fg-secondary hover:text-xyne-fg-primary disabled:opacity-50">
                      extract
                    </button>
                    <button type="button" disabled={busy === channel.channelId}
                            onClick={() => void backfillChannel(channel)}
                            className="mr-2 text-xyne-fg-tertiary hover:text-xyne-fg-secondary disabled:opacity-50">
                      backfill
                    </button>
                    <button type="button" disabled={busy === channel.channelId}
                            onClick={() => void removeChannel(channel)}
                            className="text-xyne-fg-tertiary hover:text-red-400 disabled:opacity-50">
                      remove
                    </button>
                  </td>
                </tr>
              ))}
              {project.channels.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-2 text-xyne-fg-tertiary">
                    No channels registered for this project yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {addChannelTo === project.projectId ? (
            <div className="mt-3 rounded border border-xyne-border-subtle p-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Channel ID" value={newChannel.channelId} placeholder="cmi39e2jj..."
                       onChange={(v) => setNewChannel((c) => ({ ...c, channelId: v }))} />
                <Field label="Name" value={newChannel.name} placeholder="platform-dev"
                       onChange={(v) => setNewChannel((c) => ({ ...c, name: v }))} />
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wide text-xyne-fg-tertiary">Visibility</span>
                  <select className={inputClass} value={newChannel.visibility}
                          onChange={(e) => setNewChannel((c) => ({ ...c, visibility: e.target.value }))}>
                    <option value="PUBLIC">PUBLIC</option>
                    <option value="PRIVATE">PRIVATE</option>
                  </select>
                </label>
                <Field label="Backfill from (blank = from now)" value={newChannel.backfillFrom}
                       placeholder="2026-04-13"
                       onChange={(v) => setNewChannel((c) => ({ ...c, backfillFrom: v }))} />
              </div>
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={busy === "add-channel" || !newChannel.channelId}
                        onClick={() => void addChannel(project.projectId)}
                        className="rounded-md bg-xyne-accent px-3 py-1.5 text-[11px] text-white disabled:opacity-50">
                  {busy === "add-channel" ? "Saving…" : "Include channel"}
                </button>
                <button type="button" onClick={() => setAddChannelTo(null)}
                        className="rounded-md border border-xyne-border-subtle px-3 py-1.5 text-[11px] text-xyne-fg-secondary">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setAddChannelTo(project.projectId)}
                    className="mt-3 rounded-md border border-xyne-border-subtle px-3 py-1.5 text-[11px] text-xyne-fg-secondary hover:bg-xyne-surface">
              + Add channel
            </button>
          )}

          <p className="mt-2 text-[10px] text-xyne-fg-tertiary">
            Private channels are excluded by default. Including one copies its content into a
            knowledge base with a wider audience, and KB pages cannot be deleted afterwards.
          </p>
        </section>
      ))}

      {/* Merge history. Findings are worthless until merged, so "extracted but
          never merged" is the failure this panel exists to make visible. */}
      <div className="rounded-lg border border-xyne-border-subtle bg-xyne-surface-muted p-4">
        <h4 className="text-[12px] font-medium text-xyne-fg-primary">
          Recent merges ({mergeRuns.length})
          {mergeRuns.some((r) => r.status === "FAILED") && (
            <span className="ml-2 text-[11px] font-normal text-red-400">
              {mergeRuns.filter((r) => r.status === "FAILED").length} failed
            </span>
          )}
        </h4>

        {mergeRuns.length === 0 ? (
          <p className="mt-2 text-[11px] text-xyne-fg-tertiary">
            No merges yet. Extraction writes findings to storage; nothing reaches the KB
            until a merge runs.
          </p>
        ) : (
          <table className="mt-3 w-full text-[11px]">
            <thead className="text-xyne-fg-tertiary">
              <tr className="text-left">
                <th className="pb-1 font-normal">Project</th>
                <th className="pb-1 font-normal">Day</th>
                <th className="pb-1 font-normal">Findings</th>
                <th className="pb-1 font-normal">Batches</th>
                <th className="pb-1 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {mergeRuns.map((run) => (
                <tr key={run.id} className="border-t border-xyne-border-subtle/50">
                  <td className="py-1.5 text-xyne-fg-secondary">{run.projectCode}</td>
                  <td className="py-1.5 font-mono text-[10px] text-xyne-fg-tertiary">{run.subject}</td>
                  <td className="py-1.5 text-xyne-fg-tertiary">
                    {run.metrics?.findings ?? 0}{" "}
                    <span className="opacity-60">({run.metrics?.findingsFiles ?? 0} files)</span>
                  </td>
                  <td className="py-1.5 text-xyne-fg-tertiary">{run.metrics?.batches ?? 0}</td>
                  <td className="py-1.5">
                    {run.status === "FAILED" ? (
                      <span className="text-red-400" title={run.error ?? ""}>
                        failed — {(run.error ?? "").slice(0, 50)}
                      </span>
                    ) : run.status === "NOTHING_TO_MERGE" ? (
                      <span className="text-xyne-fg-tertiary">no findings that day</span>
                    ) : run.status === "RUNNING" ? (
                      <span className="text-amber-500">running</span>
                    ) : (
                      <span className="text-green-500">merged</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Reconcile history. This is the only pass that REWRITES pages, so what it
          changed is the one thing here that cannot be reconstructed afterwards —
          the summary is the record. */}
      <div className="rounded-lg border border-xyne-border-subtle bg-xyne-surface-muted p-4">
        <button type="button" onClick={() => setShowReconcile((v) => !v)}
                className="text-[12px] font-medium text-xyne-fg-primary">
          {showReconcile ? "▾" : "▸"} Recent reconciles ({reconcileRuns.length})
          {reconcileRuns.some((r) => r.status === "FAILED") && (
            <span className="ml-2 text-[11px] font-normal text-red-400">
              {reconcileRuns.filter((r) => r.status === "FAILED").length} failed
            </span>
          )}
        </button>

        {showReconcile && (
          reconcileRuns.length === 0 ? (
            <p className="mt-3 text-[11px] text-xyne-fg-tertiary">
              Never run. The merge writes from one day at a time and cannot tell an
              authority from someone who answered once — reconcile re-reads the pages and
              corrects them.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {reconcileRuns.map((run) => (
                <li key={run.id} className="border-t border-xyne-border-subtle/50 pt-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[11px] text-xyne-fg-secondary">{run.projectCode}</span>
                    <span className="font-mono text-[10px] text-xyne-fg-tertiary">
                      {run.subject}
                    </span>
                    {run.status === "FAILED" ? (
                      <span className="text-[11px] text-red-400" title={run.error ?? ""}>
                        failed — {(run.error ?? "").slice(0, 60)}
                      </span>
                    ) : run.status === "RUNNING" ? (
                      <span className="text-[11px] text-amber-500">running</span>
                    ) : (
                      <span className="text-[11px] text-green-500">done</span>
                    )}
                  </div>
                  {run.summary && (
                    <p className="mt-1 whitespace-pre-wrap text-[10px] leading-relaxed text-xyne-fg-tertiary">
                      {run.summary.slice(0, 1200)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )
        )}
      </div>

      {/* Per-window history. The channel table shows the latest state; this is
          where you see WHICH window failed and how often. */}
      <div className="rounded-lg border border-xyne-border-subtle bg-xyne-surface-muted p-4">
        <button type="button" onClick={() => setShowRuns((v) => !v)}
                className="text-[12px] font-medium text-xyne-fg-primary">
          {showRuns ? "▾" : "▸"} Recent extraction runs ({runs.length})
          {runs.some((r) => r.status === "FAILED") && (
            <span className="ml-2 text-[11px] font-normal text-red-400">
              {runs.filter((r) => r.status === "FAILED").length} failed
            </span>
          )}
        </button>

        {showRuns && (
          runs.length === 0 ? (
            <p className="mt-3 text-[11px] text-xyne-fg-tertiary">
              No runs yet. They appear here once a channel has been extracted.
            </p>
          ) : (
            <table className="mt-3 w-full text-[11px]">
              <thead className="text-xyne-fg-tertiary">
                <tr className="text-left">
                  <th className="pb-1 font-normal">Channel</th>
                  <th className="pb-1 font-normal">Window</th>
                  <th className="pb-1 font-normal">Threads</th>
                  <th className="pb-1 font-normal">Batches</th>
                  <th className="pb-1 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-t border-xyne-border-subtle/50">
                    <td className="py-1.5 text-xyne-fg-secondary">{run.subject}</td>
                    <td className="py-1.5 font-mono text-[10px] text-xyne-fg-tertiary">
                      {day(run.windowFrom) ?? "—"}
                    </td>
                    <td className="py-1.5 text-xyne-fg-tertiary">{run.metrics?.threads ?? 0}</td>
                    <td className="py-1.5 text-xyne-fg-tertiary">{run.metrics?.batches ?? 0}</td>
                    <td className="py-1.5">
                      {run.status === "FAILED" ? (
                        <span className="text-red-400" title={run.error ?? ""}>
                          failed — {(run.error ?? "").slice(0, 60)}
                        </span>
                      ) : run.status === "RUNNING" ? (
                        <span className="text-amber-500">running</span>
                      ) : (
                        <span className="text-xyne-fg-tertiary">
                          {(run.metrics?.threads ?? 0) === 0 ? "empty window" : "done"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}
