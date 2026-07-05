import { useState, useEffect } from "react";
import {
  CalendarBlankIcon,
  AtIcon,
  CalendarIcon,
  TrashIcon,
  CaretDownIcon,
  CheckIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import type { ScheduledJob } from "../../../../lib/types";
import type { SpacesChannel } from "../../../../lib/api";
import {
  updateScheduledJob,
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
  const [savingReply, setSavingReply] = useState(false);
  const [savingChannel, setSavingChannel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { show: showSnackbar } = useSnackbar();

  const replyMode = job.replyMode ?? "thread";

  const handleReplyModeChange = async (next: "thread" | "channel") => {
    if (next === replyMode || savingReply) return;
    setSavingReply(true);
    try {
      const updated = await updateScheduledJob(job.id, { replyMode: next });
      onUpdate(updated);
    } catch (err) {
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
            <span className="text-[14px] font-medium text-xyne-fg-primary">
              {job.label || job.task}
            </span>
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
        {/* Delete — only for active jobs */}
        {isActive && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            title="Delete job"
            className="shrink-0 rounded-md p-1.5 text-xyne-fg-muted transition-colors hover:bg-xyne-error-bg hover:text-xyne-error-fg disabled:opacity-40"
          >
            <TrashIcon size={15} />
          </button>
        )}
      </div>

      {/* Output mode row */}
      <div className="flex flex-col gap-1.5 pl-11">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-xyne-fg-tertiary">output:</span>
          {/* replyMode select */}
          <div className="relative inline-flex items-center">
            <select
              value={replyMode}
              disabled={!isActive || savingReply}
              onChange={(e) => void handleReplyModeChange(e.target.value as "thread" | "channel")}
              className="appearance-none rounded-lg border border-xyne-border bg-xyne-surface py-1 pl-2.5 pr-6 text-[12px] text-xyne-fg-primary transition-colors enabled:cursor-pointer enabled:hover:border-xyne-border-strong focus:border-xyne-border-focus focus:outline-none disabled:cursor-default disabled:opacity-50"
            >
              <option value="thread">Reply in thread</option>
              <option value="channel">Post in channel</option>
            </select>
            <CaretDownIcon
              size={11}
              className="pointer-events-none absolute right-2 text-xyne-fg-muted"
            />
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
  const inactiveJobs = jobs.filter((j) => j.status !== "active");

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
