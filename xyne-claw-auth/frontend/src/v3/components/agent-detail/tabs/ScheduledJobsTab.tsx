import {
  CalendarBlankIcon,
  AtIcon,
  CalendarIcon,
} from "@phosphor-icons/react";
import type { ScheduledJob } from "../../../../lib/types";
import { Switch } from "../../ui/Switch";

interface Props {
  jobs: ScheduledJob[];
  onToggle: (job: ScheduledJob, active: boolean) => void;
}

const CRON_PRESETS: Record<string, string> = {
  "0 9 * * 1-5": "Weekdays at 9am",
  "0 9 * * *":   "Daily at 9am",
  "0 0 * * *":   "Daily at midnight",
  "0 9 * * 1":   "Mondays at 9am",
  "0 * * * *":   "Every hour",
};

function formatTrigger(job: ScheduledJob): string {
  if (job.label) return job.label;
  if (job.type === "cron" && job.cronExpression) {
    return CRON_PRESETS[job.cronExpression] ?? `Cron: ${job.cronExpression}`;
  }
  if (job.type === "once" && job.nextRunAt) {
    return `Once at ${new Date(job.nextRunAt).toLocaleString()}`;
  }
  return job.task;
}

function TriggerRow({
  job,
  onToggle,
}: {
  job: ScheduledJob;
  onToggle: (job: ScheduledJob, active: boolean) => void;
}) {
  const Icon = job.type === "cron" ? CalendarBlankIcon : AtIcon;
  const label = formatTrigger(job);
  const active = job.status === "active";
  return (
    <div className="flex items-center gap-4 border-b border-xyne-border-subtle px-4 py-3 last:border-b-0">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-xyne-surface-subtle text-xyne-fg-secondary">
        <Icon size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-xyne-fg-primary">{label}</p>
        {job.runCount > 0 && (
          <p className="mt-0.5 text-[12px] text-xyne-fg-tertiary">
            Ran {job.runCount} time{job.runCount === 1 ? "" : "s"}
            {job.lastRunAt && ` · last ${new Date(job.lastRunAt).toLocaleDateString()}`}
          </p>
        )}
      </div>
      <Switch checked={active} onChange={(v) => onToggle(job, v)} />
    </div>
  );
}

export function ScheduledJobsTab({ jobs, onToggle }: Props) {
  if (jobs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 pt-10 pb-28 text-center">
        <CalendarIcon size={32} className="text-xyne-fg-muted" />
        <p className="text-[14px] font-medium text-xyne-fg-secondary">No scheduled jobs</p>
        <p className="max-w-[280px] text-[13px] text-xyne-fg-tertiary">
          Scheduled jobs let this agent run automatically on a cron schedule or at a specific time.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="overflow-hidden rounded-xl border border-xyne-border divide-y divide-xyne-border">
        {jobs.map((job) => (
          <TriggerRow key={job.id} job={job} onToggle={onToggle} />
        ))}
      </div>
    </div>
  );
}
