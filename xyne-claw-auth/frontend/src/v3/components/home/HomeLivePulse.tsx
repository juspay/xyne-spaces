/**
 * HomeLivePulse — compact at-a-glance signal strip.
 *
 * Four signals in one row:
 *   - Sparkline of runs (bars by hour for calendar-day window).
 *   - Runs in the active window (calendar-day or rolling-24h depending on time-of-day).
 *   - Workflows active.
 *   - In-flight count.
 *
 * Configuration counts live in the right-rail WorkspaceSnapshot. This card is
 * strictly *signals*.
 */

import { useMemo } from "react";
import { Skeleton } from "../ui/Skeleton";
import type { AgentRun } from "../../../lib/api";

interface HomeLivePulseProps {
  runs: AgentRun[];
  /** Number for the active window — passed in so labels and counts stay in sync. */
  headlineRuns: number;
  /** "Today" or "Last 24h", driven by getRunsWindowLabel(). */
  windowLabel: "Today" | "Last 24h";
  activeWorkflows: number;
  runningCount: number;
  /** Unique conversation sessions today. */
  uniqueSessionsToday: number;
  /** Consecutive active days streak. */
  streak: number;
  isLoading: boolean;
}

function buildHourlyBuckets(runs: AgentRun[]): {
  hour: number;
  completed: number;
  failed: number;
  running: number;
}[] {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    completed: 0,
    failed: 0,
    running: 0,
  }));

  const now = new Date();
  const startOfDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const endOfDay = startOfDay + 24 * 60 * 60 * 1000;

  runs.forEach((r) => {
    const t = new Date(r.startedAt).getTime();
    if (t < startOfDay || t >= endOfDay) return;
    const hour = new Date(t).getHours();
    const bucket = buckets[hour];
    if (!bucket) return;
    if (r.status === "completed") bucket.completed += 1;
    else if (r.status === "failed") bucket.failed += 1;
    else if (r.status === "running") bucket.running += 1;
  });

  return buckets;
}

export function HomeLivePulse({
  runs,
  headlineRuns,
  windowLabel,
  activeWorkflows,
  runningCount,
  uniqueSessionsToday,
  streak,
  isLoading,
}: HomeLivePulseProps) {
  const buckets = useMemo(() => buildHourlyBuckets(runs), [runs]);
  const maxBucket = useMemo(
    () =>
      Math.max(
        1,
        ...buckets.map((b) => b.completed + b.failed + b.running),
      ),
    [buckets],
  );

  if (isLoading) {
    return (
      <div className="bg-xyne-surface border border-xyne-border rounded-[14px] px-[16px] py-[14px]">
        <div className="flex items-center gap-[20px]">
          <Skeleton className="h-[40px] w-[180px]" />
          <div className="flex-1 flex items-center gap-[24px]">
            <Skeleton className="h-[28px] w-[80px]" />
            <Skeleton className="h-[28px] w-[80px]" />
            <Skeleton className="h-[28px] w-[80px]" />
            <Skeleton className="h-[28px] w-[80px]" />
            <Skeleton className="h-[28px] w-[80px]" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-xyne-surface border border-xyne-border rounded-[14px] px-[16px] py-[14px]">
      <div className="flex items-center gap-[20px]">
        {/* Sparkline */}
        <div className="flex flex-col gap-[4px]">
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-xyne-fg-tertiary">
            {windowLabel}
          </span>
          <div className="flex items-end gap-[2px] h-[28px]">
            {buckets.map((b) => {
              const total = b.completed + b.failed + b.running;
              const h = total === 0 ? 2 : Math.max(3, (total / maxBucket) * 28);
              const tone =
                total === 0
                  ? "bg-xyne-border-subtle"
                  : b.failed > 0
                    ? "bg-xyne-error/70"
                    : b.running > 0
                      ? "bg-xyne-warning/80"
                      : "bg-xyne-success/70";
              return (
                <div
                  key={b.hour}
                  className={`w-[3px] rounded-[1px] ${tone}`}
                  style={{ height: `${h}px` }}
                  title={`${b.hour}:00 — ${total} run${total !== 1 ? "s" : ""}`}
                />
              );
            })}
          </div>
        </div>

        <div className="h-[36px] w-[1px] bg-xyne-border-subtle" />

        {/* Headline runs */}
        <div className="flex flex-col gap-[2px]">
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-xyne-fg-tertiary">
            Runs
          </span>
          <span className="text-[18px] font-medium text-xyne-fg-primary leading-none">
            {headlineRuns}
          </span>
        </div>

        {/* Workflows */}
        <div className="flex flex-col gap-[2px]">
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-xyne-fg-tertiary">
            Workflows
          </span>
          <span
            className={`text-[18px] font-medium leading-none ${
              activeWorkflows > 0 ? "text-xyne-fg-primary" : "text-xyne-fg-tertiary"
            }`}
          >
            {activeWorkflows}
          </span>
        </div>

        {/* In-flight */}
        <div className="flex flex-col gap-[2px]">
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-xyne-fg-tertiary">
            In flight
          </span>
          <span
            className={`text-[18px] font-medium leading-none ${
              runningCount > 0 ? "text-xyne-warning-fg" : "text-xyne-fg-primary"
            }`}
          >
            {runningCount}
          </span>
        </div>

        <div className="h-[36px] w-[1px] bg-xyne-border-subtle" />

        {/* Sessions */}
        <div className="flex flex-col gap-[2px]">
          <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-xyne-fg-tertiary">
            Sessions
          </span>
          <span className="text-[18px] font-medium text-xyne-fg-primary leading-none">
            {uniqueSessionsToday}
          </span>
        </div>

        {/* Streak */}
        {streak > 0 && (
          <div className="flex flex-col gap-[2px]">
            <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-xyne-fg-tertiary">
              Streak
            </span>
            <span className="text-[18px] font-medium text-xyne-fg-primary leading-none flex items-baseline gap-[3px]">
              {streak}
              <span className="text-[12px] text-xyne-fg-tertiary">d</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
