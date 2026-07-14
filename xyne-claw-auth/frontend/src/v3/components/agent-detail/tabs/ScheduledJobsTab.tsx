import { useState, useEffect } from "react";
import {
  CalendarBlankIcon,
  AtIcon,
  CalendarIcon,
  TrashIcon,
  CaretDownIcon,
  CheckIcon,
  MagnifyingGlassIcon,
  PauseIcon,
  PlayIcon,
  PencilSimpleIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { ScheduledJob } from "../../../../lib/types";
import type { SpacesChannel } from "../../../../lib/api";
import {
  updateScheduledJob,
  pauseScheduledJob,
  resumeScheduledJob,
  deleteScheduledJob,
  listSpacesChannels,
} from "../../../../lib/api";
import { useSnackbar } from "../../ui/Snackbar";

interface Props {
  jobs: ScheduledJob[];
  onJobsChange: (jobs: ScheduledJob[]) => void;
}

// ── Status badge ─────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-xyne-success-bg text-xyne-success-fg border-xyne-success-border",
    paused: "bg-xyne-warning-bg text-xyne-warning-fg border-xyne-warning-border",
    completed: "bg-xyne-info-bg text-xyne-info-fg border-xyne-info-border",
    cancelled: "bg-xyne-surface-subtle text-xyne-fg-muted border-xyne-border",
    failed: "bg-xyne-error-bg text-xyne-error-fg border-xyne-error-border",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${styles[status] ?? "bg-xyne-surface-subtle text-xyne-fg-muted border-xyne-border"}`}
    >
      {status}
    </span>
  );
}

function formatDateTimeLocal(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ── Channel picker ───────────────────────────────────────────────────

function ChannelPicker({
  agentSlug,
  value,
  onChange,
}: {
  agentSlug: string;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SpacesChannel[]>([]);

  // Fetch channels whenever picker is open (debounced)
  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const rows = await listSpacesChannels(query || undefined, 20, agentSlug).catch(() => []);
      if (!cancelled) setResults(rows);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [editing, query, agentSlug]);

  const selectedName = value
    ? results.find((c) => c.id === value)?.name ?? `…${value.slice(-6)}`
    : null;

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-xyne-border bg-xyne-surface px-2.5 py-1 text-[12px] hover:border-xyne-border-strong transition-colors"
      >
        {selectedName ? (
          <span className="text-xyne-fg-primary font-medium">#{selectedName}</span>
        ) : (
          <span className="text-xyne-fg-placeholder">originating channel</span>
        )}
        <CaretDownIcon size={10} className="text-xyne-fg-muted" />
      </button>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-1">
      <div className="flex items-center gap-2 rounded-lg border border-xyne-border-focus bg-xyne-surface px-3 py-1.5">
        <MagnifyingGlassIcon size={13} className="shrink-0 text-xyne-fg-muted" />
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={() => setTimeout(() => setEditing(false), 150)}
          placeholder="Search channels…"
          className="flex-1 bg-transparent text-[13px] text-xyne-fg-primary placeholder:text-xyne-fg-placeholder outline-none"
        />
      </div>
      {(results.length > 0 || value) && (
        <div className="overflow-hidden rounded-lg border border-xyne-border bg-xyne-surface">
          {value && (
            <button
              type="button"
              onMouseDown={() => { onChange(null); setEditing(false); }}
              className="block w-full px-3 py-2 text-left text-[12px] text-xyne-fg-secondary hover:bg-xyne-surface-subtle"
            >
              Use originating channel
            </button>
          )}
          {results.map((ch) => (
            <button
              key={ch.id}
              type="button"
              onMouseDown={() => { onChange(ch.id); setEditing(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-xyne-fg-primary hover:bg-xyne-surface-subtle"
            >
              <span className="text-xyne-fg-muted">#</span>
              <span className="flex-1 truncate">{ch.name}</span>
              {ch.id === value && <CheckIcon size={12} className="shrink-0 text-xyne-success-fg" />}
            </button>
          ))}
          {results.length === 0 && (
            <p className="px-3 py-2.5 text-[12px] text-xyne-fg-muted">No channels found</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Job card ─────────────────────────────────────────────────────────

function JobCard({
  job,
  onUpdate,
  onDelete,
}: {
  job: ScheduledJob;
  onUpdate: (updated: ScheduledJob) => void;
  onDelete: (jobId: string) => void;
}) {
  const Icon = job.type === "cron" ? CalendarBlankIcon : AtIcon;
  const isActive = job.status === "active";
  const isPaused = job.status === "paused";
  const canEditJob = isActive || isPaused;
  const isCron = job.type === "cron";
  const isOnce = job.type === "once";
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");
  const [savingLabel, setSavingLabel] = useState(false);
  const [savingReply, setSavingReply] = useState(false);
  const [savingChannel, setSavingChannel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [editingCron, setEditingCron] = useState(false);
  const [cronDraft, setCronDraft] = useState("");
  const [savingCron, setSavingCron] = useState(false);
  const [editingRunAt, setEditingRunAt] = useState(false);
  const [runAtDraft, setRunAtDraft] = useState("");
  const [savingRunAt, setSavingRunAt] = useState(false);
  const [editingTask, setEditingTask] = useState(false);
  const [taskDraft, setTaskDraft] = useState("");
  const [savingTask, setSavingTask] = useState(false);
  const { show: showSnackbar } = useSnackbar();

  const replyMode = job.replyMode ?? "thread";

  const handleSaveTask = async () => {
    const next = taskDraft.trim();
    if (next.length === 0) {
      showSnackbar({ variant: "error", title: "Prompt cannot be empty" });
      return;
    }
    if (next === job.task) {
      setEditingTask(false);
      return;
    }
    setSavingTask(true);
    const previous = job;
    onUpdate({ ...job, task: next });
    try {
      const updated = await updateScheduledJob(job.id, { task: next });
      onUpdate(updated);
      setEditingTask(false);
    } catch (err) {
      onUpdate(previous);
      showSnackbar({ variant: "error", title: err instanceof Error ? err.message : "Failed to update prompt" });
    } finally {
      setSavingTask(false);
    }
  };

  const handleSaveLabel = async () => {
    const next = labelDraft.trim() || null;
    if (next === job.label) {
      setEditingLabel(false);
      return;
    }
    setSavingLabel(true);
    const previous = job;
    onUpdate({ ...job, label: next });
    try {
      const updated = await updateScheduledJob(job.id, { label: next });
      onUpdate(updated);
      setEditingLabel(false);
    } catch (err) {
      onUpdate(previous);
      showSnackbar({ variant: "error", title: err instanceof Error ? err.message : "Failed to update label" });
    } finally {
      setSavingLabel(false);
    }
  };

  const handleReplyModeChange = async (next: "thread" | "channel") => {
    if (next === replyMode || savingReply) return;
    setSavingReply(true);
    const previous = job;
    onUpdate({ ...job, replyMode: next });
    try {
      const updated = await updateScheduledJob(job.id, { replyMode: next });
      onUpdate(updated);
    } catch (err) {
      onUpdate(previous);
      showSnackbar({ variant: "error", title: err instanceof Error ? err.message : "Failed to update reply mode" });
    } finally {
      setSavingReply(false);
    }
  };

  const handleChannelChange = async (channelId: string | null) => {
    if (savingChannel) return;
    setSavingChannel(true);
    try {
      const updated = await updateScheduledJob(job.id, { targetChannelId: channelId });
      onUpdate(updated);
    } catch (err) {
      showSnackbar({ variant: "error", title: err instanceof Error ? err.message : "Failed to update channel" });
    } finally {
      setSavingChannel(false);
    }
  };

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteScheduledJob(job.id);
      onDelete(job.id);
    } catch (err) {
      showSnackbar({ variant: "error", title: err instanceof Error ? err.message : "Failed to delete job" });
      setDeleting(false);
    }
  };

  // Pause an active job or resume a paused one. Backend returns { id, status,
  // nextRunAt? } — merge onto the existing row so the card updates in place.
  const handlePauseResume = async () => {
    if (savingStatus) return;
    setSavingStatus(true);
    try {
      const result = isActive
        ? await pauseScheduledJob(job.id)
        : await resumeScheduledJob(job.id);
      onUpdate({
        ...job,
        status: result.status,
        ...(result.nextRunAt ? { nextRunAt: result.nextRunAt } : {}),
      });
    } catch (err) {
      showSnackbar({ variant: "error", title: err instanceof Error ? err.message : "Failed to update job" });
    } finally {
      setSavingStatus(false);
    }
  };

  // Reschedule a cron job. Server re-binds the BullMQ scheduler and validates
  // the expression; only active cron jobs are editable (button hidden otherwise).
  const handleSaveCron = async () => {
    const next = cronDraft.trim();
    if (!next || next === job.cronExpression) {
      setEditingCron(false);
      return;
    }
    setSavingCron(true);
    try {
      const updated = await updateScheduledJob(job.id, { cronExpression: next });
      onUpdate(updated);
      setEditingCron(false);
    } catch (err) {
      showSnackbar({ variant: "error", title: err instanceof Error ? err.message : "Failed to update schedule" });
    } finally {
      setSavingCron(false);
    }
  };

  const handleSaveRunAt = async () => {
    if (!runAtDraft) {
      setEditingRunAt(false);
      return;
    }
    if (runAtDraft === formatDateTimeLocal(job.nextRunAt)) {
      setEditingRunAt(false);
      return;
    }
    const nextRunAtDate = new Date(runAtDraft);
    if (Number.isNaN(nextRunAtDate.getTime())) {
      showSnackbar({ variant: "error", title: "Enter a valid run time" });
      return;
    }
    const nextRunAt = nextRunAtDate.toISOString();
    setSavingRunAt(true);
    const previous = job;
    onUpdate({ ...job, nextRunAt });
    try {
      const updated = await updateScheduledJob(job.id, { nextRunAt });
      onUpdate(updated);
      setEditingRunAt(false);
    } catch (err) {
      onUpdate(previous);
      showSnackbar({ variant: "error", title: err instanceof Error ? err.message : "Failed to update run time" });
    } finally {
      setSavingRunAt(false);
    }
  };

  const runMeta = [
    job.type === "cron" && job.cronExpression ? job.cronExpression : null,
    job.type === "once" && job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : null,
    job.maxRuns != null
      ? `runs: ${job.runCount}/${job.maxRuns}`
      : job.runCount > 0
        ? `runs: ${job.runCount}`
        : null,
    job.createdAt ? `created: ${new Date(job.createdAt).toLocaleDateString()}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-xyne-border bg-xyne-surface p-4">
      {/* Header row */}
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-xyne-surface-subtle text-xyne-fg-secondary">
          <Icon size={16} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            {editingLabel ? (
              <div className="flex min-w-0 items-center gap-1.5">
                <input
                  autoFocus
                  type="text"
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSaveLabel();
                    if (e.key === "Escape") setEditingLabel(false);
                  }}
                  placeholder="Job label"
                  className="min-w-0 rounded-lg border border-xyne-border-focus bg-xyne-surface px-2 py-1 text-[13px] text-xyne-fg-primary outline-none"
                />
                <button
                  type="button"
                  onClick={() => void handleSaveLabel()}
                  disabled={savingLabel}
                  title="Save label"
                  className="rounded-md p-1 text-xyne-success-fg hover:bg-xyne-success-bg disabled:opacity-40"
                >
                  <CheckIcon size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setEditingLabel(false)}
                  disabled={savingLabel}
                  title="Cancel"
                  className="rounded-md p-1 text-xyne-fg-muted hover:bg-xyne-surface-subtle disabled:opacity-40"
                >
                  <XIcon size={14} />
                </button>
              </div>
            ) : (
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[14px] font-medium text-xyne-fg-primary">
                  {job.label || job.task}
                </span>
                {canEditJob && (
                  <button
                    type="button"
                    onClick={() => {
                      setLabelDraft(job.label || "");
                      setEditingLabel(true);
                    }}
                    title="Edit label"
                    className="rounded-md p-1 text-xyne-fg-muted hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
                  >
                    <PencilSimpleIcon size={13} />
                  </button>
                )}
              </div>
            )}
            <StatusBadge status={job.status} />
          </div>
          {/* meta: cron/time · runs · created */}
          {runMeta.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-xyne-fg-tertiary">
              {runMeta.map((m, i) => (
                <span key={i} className="font-mono">{m}</span>
              ))}
            </div>
          )}
          {/* task snippet when a label is set */}
          {job.label && (
            <p className="mt-0.5 truncate text-[12px] text-xyne-fg-muted">{job.task}</p>
          )}
        </div>
        {/* Pause / resume + delete controls */}
        <div className="flex shrink-0 items-center gap-1">
          {isActive && (
            <button
              type="button"
              onClick={() => void handlePauseResume()}
              disabled={savingStatus}
              title="Pause job"
              className="rounded-md p-1.5 text-xyne-fg-muted transition-colors hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary disabled:opacity-40"
            >
              <PauseIcon size={15} />
            </button>
          )}
          {isPaused && (
            <button
              type="button"
              onClick={() => void handlePauseResume()}
              disabled={savingStatus}
              title="Resume job"
              className="rounded-md p-1.5 text-xyne-success-fg transition-colors hover:bg-xyne-success-bg disabled:opacity-40"
            >
              <PlayIcon size={15} />
            </button>
          )}
          {(isActive || isPaused) && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              title="Delete job"
              className="rounded-md p-1.5 text-xyne-fg-muted transition-colors hover:bg-xyne-error-bg hover:text-xyne-error-fg disabled:opacity-40"
            >
              <TrashIcon size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Prompt row — edit the task/prompt the agent runs on each fire */}
      <div className="flex flex-col gap-1.5 pl-11">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] text-xyne-fg-tertiary">prompt:</span>
          {canEditJob && !editingTask && (
            <button
              type="button"
              onClick={() => {
                setTaskDraft(job.task);
                setEditingTask(true);
              }}
              title="Edit prompt"
              className="rounded-md p-1 text-xyne-fg-muted hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
            >
              <PencilSimpleIcon size={13} />
            </button>
          )}
        </div>
        {editingTask ? (
          <div className="flex flex-col gap-1.5">
            <textarea
              autoFocus
              value={taskDraft}
              onChange={(e) => setTaskDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void handleSaveTask();
                if (e.key === "Escape") setEditingTask(false);
              }}
              rows={3}
              placeholder="What should the agent do on each run?"
              className="w-full resize-y rounded-lg border border-xyne-border-focus bg-xyne-surface px-2 py-1.5 text-[13px] leading-snug text-xyne-fg-primary outline-none"
            />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void handleSaveTask()}
                disabled={savingTask}
                className="inline-flex items-center gap-1 rounded-md bg-xyne-fg-primary px-2 py-1 text-[12px] font-medium text-xyne-surface hover:opacity-90 disabled:opacity-40"
              >
                <CheckIcon size={13} /> Save
              </button>
              <button
                type="button"
                onClick={() => setEditingTask(false)}
                disabled={savingTask}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-xyne-fg-muted hover:bg-xyne-surface-subtle disabled:opacity-40"
              >
                <XIcon size={13} /> Cancel
              </button>
              <span className="text-[11px] text-xyne-fg-tertiary">⌘/Ctrl+Enter to save</span>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words text-[12px] leading-snug text-xyne-fg-secondary">
            {job.task}
          </p>
        )}
      </div>

      {/* Schedule row — active cron jobs can edit the cron expression */}
      {isCron && (
        <div className="flex flex-wrap items-center gap-2 pl-11">
          <span className="text-[12px] text-xyne-fg-tertiary">schedule:</span>
          {editingCron ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                type="text"
                value={cronDraft}
                onChange={(e) => setCronDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSaveCron();
                  if (e.key === "Escape") setEditingCron(false);
                }}
                placeholder="* * * * *"
                className="w-36 rounded-lg border border-xyne-border-focus bg-xyne-surface px-2 py-1 font-mono text-[12px] text-xyne-fg-primary outline-none"
              />
              <button
                type="button"
                onClick={() => void handleSaveCron()}
                disabled={savingCron}
                title="Save schedule"
                className="rounded-md p-1 text-xyne-success-fg hover:bg-xyne-success-bg disabled:opacity-40"
              >
                <CheckIcon size={14} />
              </button>
              <button
                type="button"
                onClick={() => setEditingCron(false)}
                disabled={savingCron}
                title="Cancel"
                className="rounded-md p-1 text-xyne-fg-muted hover:bg-xyne-surface-subtle disabled:opacity-40"
              >
                <XIcon size={14} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[12px] text-xyne-fg-secondary">
                {job.cronExpression || "—"}
              </span>
              {isActive && (
                <button
                  type="button"
                  onClick={() => {
                    setCronDraft(job.cronExpression || "");
                    setEditingCron(true);
                  }}
                  title="Edit schedule"
                  className="rounded-md p-1 text-xyne-fg-muted hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
                >
                  <PencilSimpleIcon size={13} />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Run time row — active one-shot jobs can edit the next run time */}
      {isOnce && isActive && (
        <div className="flex flex-wrap items-center gap-2 pl-11">
          <span className="text-[12px] text-xyne-fg-tertiary">run at:</span>
          {editingRunAt ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                type="datetime-local"
                value={runAtDraft}
                onChange={(e) => setRunAtDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSaveRunAt();
                  if (e.key === "Escape") setEditingRunAt(false);
                }}
                className="rounded-lg border border-xyne-border-focus bg-xyne-surface px-2 py-1 text-[12px] text-xyne-fg-primary outline-none"
              />
              <button
                type="button"
                onClick={() => void handleSaveRunAt()}
                disabled={savingRunAt}
                title="Save run time"
                className="rounded-md p-1 text-xyne-success-fg hover:bg-xyne-success-bg disabled:opacity-40"
              >
                <CheckIcon size={14} />
              </button>
              <button
                type="button"
                onClick={() => setEditingRunAt(false)}
                disabled={savingRunAt}
                title="Cancel"
                className="rounded-md p-1 text-xyne-fg-muted hover:bg-xyne-surface-subtle disabled:opacity-40"
              >
                <XIcon size={14} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[12px] text-xyne-fg-secondary">
                {job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : "—"}
              </span>
              <button
                type="button"
                onClick={() => {
                  setRunAtDraft(formatDateTimeLocal(job.nextRunAt));
                  setEditingRunAt(true);
                }}
                title="Edit run time"
                className="rounded-md p-1 text-xyne-fg-muted hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
              >
                <PencilSimpleIcon size={13} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Output mode row */}
      <div className="flex flex-col gap-1.5 pl-11">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-xyne-fg-tertiary">output:</span>
          {/* replyMode toggle */}
          <div className="inline-flex overflow-hidden rounded-lg border border-xyne-border bg-xyne-surface">
            {(["thread", "channel"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => void handleReplyModeChange(mode)}
                disabled={!canEditJob || savingReply}
                className={`px-2.5 py-1 text-[12px] transition-colors disabled:cursor-default disabled:opacity-50 ${
                  replyMode === mode
                    ? "bg-xyne-surface-subtle text-xyne-fg-primary"
                    : "text-xyne-fg-secondary hover:bg-xyne-surface-subtle hover:text-xyne-fg-primary"
                }`}
              >
                {mode === "thread" ? "Thread" : "Channel"}
              </button>
            ))}
          </div>
          {/* Channel chip — only when mode is "channel", job is active, and not saving */}
          {replyMode === "channel" && isActive && !savingChannel && (
            <ChannelPicker
              agentSlug={job.agentSlug}
              value={job.targetChannelId}
              onChange={(id) => void handleChannelChange(id)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tab ──────────────────────────────────────────────────────────────

export function ScheduledJobsTab({ jobs, onJobsChange }: Props) {
  const handleUpdate = (updated: ScheduledJob) =>
    onJobsChange(jobs.map((j) => (j.id === updated.id ? updated : j)));

  const handleDelete = (jobId: string) =>
    onJobsChange(jobs.filter((j) => j.id !== jobId));

  if (jobs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 pt-10 pb-28 text-center">
        <CalendarIcon size={32} className="text-xyne-fg-muted" />
        <p className="text-[14px] font-medium text-xyne-fg-secondary">No scheduled jobs</p>
        <p className="max-w-70 text-[13px] text-xyne-fg-tertiary">
          Scheduled jobs let this agent run automatically on a cron schedule or at a specific time.
        </p>
      </div>
    );
  }

  const activeJobs = jobs.filter((j) => j.status === "active");
  const pausedJobs = jobs.filter((j) => j.status === "paused");
  const inactiveJobs = jobs.filter(
    (j) => j.status !== "active" && j.status !== "paused",
  );

  return (
    <div className="flex flex-col gap-5 p-4">
      {activeJobs.length > 0 && (
        <section className="flex flex-col gap-2">
          <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">
            Active
          </p>
          {activeJobs.map((job) => (
            <JobCard key={job.id} job={job} onUpdate={handleUpdate} onDelete={handleDelete} />
          ))}
        </section>
      )}
      {pausedJobs.length > 0 && (
        <section className="flex flex-col gap-2">
          <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">
            Paused
          </p>
          {pausedJobs.map((job) => (
            <JobCard key={job.id} job={job} onUpdate={handleUpdate} onDelete={handleDelete} />
          ))}
        </section>
      )}
      {inactiveJobs.length > 0 && (
        <section className="flex flex-col gap-2">
          <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-xyne-fg-tertiary">
            Completed / Cancelled
          </p>
          {inactiveJobs.map((job) => (
            <JobCard key={job.id} job={job} onUpdate={handleUpdate} onDelete={handleDelete} />
          ))}
        </section>
      )}
    </div>
  );
}
