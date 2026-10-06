/**
 * child-task-tools.ts — parent-facing control over its own background children.
 *
 * Background work is otherwise write-only from the parent's side: it fires, and
 * the answer arrives whenever the drain loop runs. These let the model see what
 * is still running and kill one child without touching its siblings. Both are
 * no-ops when nothing was spawned.
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { cancelChildTask, summarizeChildTasks, type ChildTaskRegistry } from "./child-tasks.js";
import { createLogger } from "./logger.js";

const log = createLogger("child-task-tools");

function text(body: string): { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } {
  return { content: [{ type: "text", text: body }], details: {} };
}

function renderTasks(registry: ChildTaskRegistry): string {
  const rows = summarizeChildTasks(registry);
  if (rows.length === 0) return "No background work has been started in this run.";
  const lines = rows.map((r) => {
    const secs = (r.elapsedMs / 1000).toFixed(1);
    const what = r.kind === "agent" ? "agent" : "subagent";
    const tail = r.error ? ` — ${r.error}` : "";
    return `- ${r.taskId} · ${what} "${r.name}" · ${r.status} after ${secs}s${tail}\n    ${r.question}`;
  });
  const running = rows.filter((r) => r.status === "running").length;
  return `${rows.length} background task(s), ${running} still running:\n${lines.join("\n")}`;
}

export function buildChildTaskTools(registry: ChildTaskRegistry): ToolDefinition[] {
  return [
    {
      name: "task-status",
      label: "Task Status",
      description:
        "List the background subagents and delegated agents you started in this run, with their status and how long each has been going. " +
        "Use it when you want to know whether something you fired off is still working before you decide to wait, stop it, or answer without it. " +
        "You do NOT need this to collect results — finished work is delivered to you automatically before you finish your reply.",
      parameters: Type.Unsafe({ type: "object", additionalProperties: false, properties: {} }),
      async execute() {
        return text(renderTasks(registry));
      },
    },
    {
      name: "task-stop",
      label: "Stop Task",
      description:
        "Cancel one background subagent or delegated agent you started, by its task id (see task-status). " +
        "Stops only that one — everything else you started keeps running, and so does your own turn. " +
        "A cancelled task returns no answer, so say what you could not get rather than inventing it.",
      parameters: Type.Unsafe({
        type: "object",
        additionalProperties: false,
        required: ["taskId"],
        properties: {
          taskId: { type: "string", description: "The task id reported by task-status or by the spawn acknowledgement." },
        },
      }),
      async execute(_toolCallId: string, params: unknown) {
        const taskId = String((params as Record<string, unknown> | null | undefined)?.["taskId"] ?? "").trim();
        if (!taskId) return text("Pass the taskId of the task to stop. Call task-status to list them.");
        const task = cancelChildTask(registry, taskId);
        if (!task) {
          const known = summarizeChildTasks(registry).map((r) => r.taskId);
          return text(
            `No task ${taskId} in this run.${known.length > 0 ? ` Known task ids: ${known.join(", ")}.` : ""}`,
          );
        }
        if (task.status !== "cancelled") {
          return text(`Task ${taskId} ("${task.name}") had already ${task.status === "running" ? "finished" : task.status}; nothing to stop.`);
        }
        log.info(`[task-stop] cancelled ${task.kind} "${task.name}" (task=${taskId.slice(0, 8)})`);
        return text(`Stopped ${task.kind} "${task.name}" (task ${taskId}). It will not return an answer.`);
      },
    },
  ] as unknown as ToolDefinition[];
}
