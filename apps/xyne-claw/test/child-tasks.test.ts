/**
 * child-tasks.test.ts — the registry both spawners share, and the tools that
 * expose it to the parent model. Pins the three guarantees: a terminal state is
 * recorded once (a cancel must survive the loop unwinding after it), a cancelled
 * child is never delivered back, and stopping one child spares its siblings.
 */
import { describe, it, expect } from "vitest";
import {
  cancelChildTask,
  createChildTaskRegistry,
  summarizeChildTasks,
  track,
  type ChildTaskResult,
} from "../src/child-tasks.js";
import { buildChildTaskTools } from "../src/child-task-tools.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok = (text: string): ChildTaskResult => ({ content: [{ type: "text", text }], details: {} });

function spawn(
  registry: ReturnType<typeof createChildTaskRegistry>,
  taskId: string,
  opts: { kind?: "subagent" | "agent"; work: () => Promise<ChildTaskResult>; cancel?: () => void } ,
) {
  return track(registry, {
    taskId,
    kind: opts.kind ?? "subagent",
    name: `${taskId}-name`,
    question: `question for ${taskId}`,
    startedAt: Date.now(),
    promise: opts.work(),
    cancel: opts.cancel ?? (() => {}),
  });
}

describe("child task registry", () => {
  it("records a completed result off the detached promise", async () => {
    const reg = createChildTaskRegistry();
    const t = spawn(reg, "t1", { work: async () => ok("done") });
    await t.promise;
    await sleep(0);
    expect(t.status).toBe("completed");
    expect(t.result).toBe("done");
    expect(t.finishedAt).toBeDefined();
  });

  it("records a rejection without an unhandled rejection", async () => {
    const reg = createChildTaskRegistry();
    const t = spawn(reg, "t1", { work: async () => { throw new Error("boom"); } });
    await t.promise.catch(() => {});
    await sleep(0);
    expect(t.status).toBe("error");
    expect(t.error).toBe("boom");
  });

  it("cancel wins over a later resolution and is not re-delivered", async () => {
    const reg = createChildTaskRegistry();
    let cancelled = false;
    const t = spawn(reg, "t1", {
      work: async () => { await sleep(20); return ok("late answer"); },
      cancel: () => { cancelled = true; },
    });

    expect(cancelChildTask(reg, "t1")?.status).toBe("cancelled");
    expect(cancelled).toBe(true);
    // A cancelled child has nothing to inject, so the drain loop must skip it.
    expect(t.delivered).toBe(true);

    await t.promise;
    await sleep(0);
    expect(t.status).toBe("cancelled");
    expect(t.result).toBeUndefined();
  });

  it("cancelling one child leaves its siblings running", async () => {
    const reg = createChildTaskRegistry();
    const aborted: string[] = [];
    spawn(reg, "a", { work: async () => { await sleep(30); return ok("a"); }, cancel: () => aborted.push("a") });
    const b = spawn(reg, "b", { work: async () => { await sleep(30); return ok("b"); }, cancel: () => aborted.push("b") });

    cancelChildTask(reg, "a");
    expect(aborted).toEqual(["a"]);
    expect(b.status).toBe("running");

    await b.promise;
    await sleep(0);
    expect(b.status).toBe("completed");
  });

  it("cancel is idempotent and tolerates an unknown id", async () => {
    const reg = createChildTaskRegistry();
    spawn(reg, "t1", { work: async () => ok("x") });
    expect(cancelChildTask(reg, "nope")).toBeNull();
    const first = cancelChildTask(reg, "t1");
    const second = cancelChildTask(reg, "t1");
    expect(first?.status).toBe("cancelled");
    expect(second?.status).toBe("cancelled");
  });

  it("a cancel callback that throws still records the terminal state", () => {
    const reg = createChildTaskRegistry();
    spawn(reg, "t1", { work: async () => ok("x"), cancel: () => { throw new Error("already gone"); } });
    expect(() => cancelChildTask(reg, "t1")).not.toThrow();
    expect(reg.get("t1")?.status).toBe("cancelled");
  });

  it("summarizes in start order and truncates a long question", () => {
    const reg = createChildTaskRegistry();
    track(reg, {
      taskId: "second", kind: "agent", name: "cards-doctor", question: "x".repeat(400),
      startedAt: 2000, promise: Promise.resolve(ok("")), cancel: () => {},
    });
    track(reg, {
      taskId: "first", kind: "subagent", name: "spaces", question: "short",
      startedAt: 1000, promise: Promise.resolve(ok("")), cancel: () => {},
    });
    const rows = summarizeChildTasks(reg);
    expect(rows.map((r) => r.taskId)).toEqual(["first", "second"]);
    expect(rows[1]!.question).toHaveLength(201); // 200 chars + ellipsis
    expect(rows[1]!.kind).toBe("agent");
  });
});

describe("task-status / task-stop tools", () => {
  const toolsFor = (reg: ReturnType<typeof createChildTaskRegistry>) => {
    const [status, stop] = buildChildTaskTools(reg) as unknown as Array<{
      name: string;
      execute(id: string, params: unknown): Promise<{ content: Array<{ text: string }> }>;
    }>;
    return { status: status!, stop: stop! };
  };

  it("reports nothing when no child was spawned", async () => {
    const { status } = toolsFor(createChildTaskRegistry());
    const res = await status.execute("c1", {});
    expect(res.content[0]!.text).toMatch(/No background work/);
  });

  it("lists running work with its kind and task id", async () => {
    const reg = createChildTaskRegistry();
    spawn(reg, "task-abc", { kind: "agent", work: async () => { await sleep(50); return ok("x"); } });
    const { status } = toolsFor(reg);
    const text = (await status.execute("c1", {})).content[0]!.text;
    expect(text).toContain("task-abc");
    expect(text).toContain('agent "task-abc-name"');
    expect(text).toContain("still running");
  });

  it("stops a named task and says so", async () => {
    const reg = createChildTaskRegistry();
    let cancelled = false;
    spawn(reg, "task-abc", {
      kind: "agent",
      work: async () => { await sleep(50); return ok("x"); },
      cancel: () => { cancelled = true; },
    });
    const { stop } = toolsFor(reg);
    const text = (await stop.execute("c1", { taskId: "task-abc" })).content[0]!.text;
    expect(cancelled).toBe(true);
    expect(text).toContain("Stopped agent");
    expect(text).toContain("task-abc");
  });

  it("names the known ids when asked to stop an unknown task", async () => {
    const reg = createChildTaskRegistry();
    spawn(reg, "real-one", { work: async () => ok("x") });
    const { stop } = toolsFor(reg);
    const text = (await stop.execute("c1", { taskId: "ghost" })).content[0]!.text;
    expect(text).toContain("No task ghost");
    expect(text).toContain("real-one");
  });

  it("requires a taskId", async () => {
    const { stop } = toolsFor(createChildTaskRegistry());
    const text = (await stop.execute("c1", {})).content[0]!.text;
    expect(text).toMatch(/Pass the taskId/);
  });
});
