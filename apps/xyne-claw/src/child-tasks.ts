/**
 * child-tasks.ts — the parent run's registry of spawned children.
 *
 * Both spawners — a subagent tool and an A2A delegation — can run non-blocking,
 * need their result injected before the parent answers, and need to be
 * inspectable and cancellable meanwhile. One concern, so one registry.
 *
 * Lifetime is a single parent run: `runTask` creates it, hands it to the tool
 * builders, and drains it after the model loop settles.
 */

export type ChildTaskKind = "subagent" | "agent";

export type ChildTaskStatus = "running" | "completed" | "error" | "cancelled";

export interface ChildTaskResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}

export interface ChildTask {
  /** The spawning tool_call_id, also the `parentToolCallId` on the child's
   *  trace rows, so the registry entry and the debug tree agree. */
  taskId: string;
  kind: ChildTaskKind;
  /** Subagent name or callee agent slug. */
  name: string;
  question: string;
  startedAt: number;
  finishedAt?: number;
  status: ChildTaskStatus;
  /** The detached execution. `track()` already handles its rejection into
   *  status/error; readers use those fields, never this promise. */
  promise: Promise<ChildTaskResult>;
  result?: string;
  error?: string;
  /** True once the parent's drain loop has injected this back into the session. */
  delivered: boolean;
  /** Cancels this child alone. Distinct from the parent's abortSignal, which
   *  stops everything — stopping one slow child must not touch its siblings. */
  cancel: () => void;
}

export type ChildTaskRegistry = Map<string, ChildTask>;

export function createChildTaskRegistry(): ChildTaskRegistry {
  return new Map();
}

/**
 * Register a detached child and attach its terminal-state handlers — here
 * rather than per call site, because an unhandled rejection on a detached
 * promise takes the process down.
 */
export function track(
  registry: ChildTaskRegistry,
  task: Omit<ChildTask, "status" | "delivered" | "result" | "error" | "finishedAt">,
): ChildTask {
  const entry: ChildTask = { ...task, status: "running", delivered: false };
  entry.promise.then(
    (r) => {
      // A cancel already recorded the terminal state; the loop unwinding
      // afterwards must not overwrite it with a success.
      if (entry.status !== "running") return;
      entry.status = "completed";
      entry.finishedAt = Date.now();
      entry.result = r.content?.[0]?.text ?? "";
    },
    (err) => {
      if (entry.status !== "running") return;
      entry.status = "error";
      entry.finishedAt = Date.now();
      entry.error = err instanceof Error ? err.message : String(err);
    },
  );
  registry.set(entry.taskId, entry);
  return entry;
}

/** Mark a child cancelled and signal its run to unwind. Idempotent. */
export function cancelChildTask(registry: ChildTaskRegistry, taskId: string): ChildTask | null {
  const task = registry.get(taskId);
  if (!task) return null;
  if (task.status !== "running") return task;
  task.status = "cancelled";
  task.finishedAt = Date.now();
  // A cancelled child has nothing useful to inject, so the drain loop skips it.
  task.delivered = true;
  try {
    task.cancel();
  } catch {
    // The child is already gone; the recorded status is what matters.
  }
  return task;
}

export interface ChildTaskSummary {
  taskId: string;
  kind: ChildTaskKind;
  name: string;
  status: ChildTaskStatus;
  elapsedMs: number;
  question: string;
  error?: string;
}

function summarizeChildTask(task: ChildTask, now: number): ChildTaskSummary {
  return {
    taskId: task.taskId,
    kind: task.kind,
    name: task.name,
    status: task.status,
    elapsedMs: (task.finishedAt ?? now) - task.startedAt,
    question: task.question.length > 200 ? `${task.question.slice(0, 200)}…` : task.question,
    ...(task.error ? { error: task.error } : {}),
  };
}

export function summarizeChildTasks(registry: ChildTaskRegistry): ChildTaskSummary[] {
  const now = Date.now();
  return [...registry.values()]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((t) => summarizeChildTask(t, now));
}
