import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import type { ScheduledJob, ScheduledJobRun } from "../../../lib/types";
import { timeAgo, dur } from "../../utils";

// ── StatusBadge ───────────────────────────────────────────────────────
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "bg-green-100 text-green-700",
    completed: "bg-blue-100 text-blue-700",
    cancelled: "bg-zinc-100 text-zinc-500",
    started: "bg-yellow-100 text-yellow-700",
    failed: "bg-red-100 text-red-700",
    error: "bg-red-100 text-red-700",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? "bg-zinc-100 text-zinc-500"}`}>
      {status}
    </span>
  );
}

// ── JobCard ───────────────────────────────────────────────────────────
interface JobCardProps {
  job: ScheduledJob;
  deleting: boolean;
  onDelete: (id: string) => void;
}

export function JobCard({ job, deleting, onDelete }: JobCardProps) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-zinc-800">{job.label || job.task.slice(0, 60)}</span>
            <StatusBadge status={job.status} />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
            {job.type === "cron" && job.cronExpression && <span>cron: {job.cronExpression}</span>}
            {job.type === "once" && job.nextRunAt && <span>runs at: {new Date(job.nextRunAt).toLocaleString()}</span>}
            <span>runs: {job.runCount}{job.maxRuns ? `/${job.maxRuns}` : ""}</span>
            {job.lastRunAt && <span>last: {timeAgo(job.lastRunAt)}</span>}
          </div>
        </div>
        {job.status === "active" && (
          <button onClick={() => onDelete(job.id)} disabled={deleting}
            className="ml-3 rounded p-1.5 text-red-400 hover:bg-red-50 disabled:opacity-50">
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── RunCard ───────────────────────────────────────────────────────────
interface RunCardProps {
  run: ScheduledJobRun;
  expanded: boolean;
  onToggle: () => void;
}

export function RunCard({ run, expanded, onToggle }: RunCardProps) {
  const label = run.scheduledJob?.label || run.scheduledJob?.task?.slice(0, 40) || run.scheduledJobId;
  const hasContent = !!(run.result || run.error);
  return (
    <div className="rounded-xl border border-zinc-200 bg-white">
      <div className={`flex items-center gap-3 p-4 ${hasContent ? "cursor-pointer" : ""}`}
        onClick={hasContent ? onToggle : undefined}>
        {hasContent
          ? (expanded ? <ChevronDown size={15} className="text-zinc-400" /> : <ChevronRight size={15} className="text-zinc-400" />)
          : <div className="w-4" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-zinc-800">{label}</span>
            <StatusBadge status={run.status} />
          </div>
          <div className="mt-0.5 flex gap-4 text-xs text-zinc-400">
            <span>{timeAgo(run.startedAt)}</span>
            <span>{dur(run.startedAt, run.completedAt)}</span>
          </div>
        </div>
      </div>
      {expanded && hasContent && (
        <div className="border-t border-zinc-100 p-4">
          {run.error && (
            <pre className="mb-2 whitespace-pre-wrap rounded-lg bg-red-50 p-3 text-xs text-red-600">{run.error}</pre>
          )}
          {run.result && (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-xs text-zinc-700">{run.result}</pre>
          )}
        </div>
      )}
    </div>
  );
}
