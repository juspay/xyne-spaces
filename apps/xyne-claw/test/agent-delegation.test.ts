/**
 * agent-delegation.test.ts — governance guarantees for A2A delegation.
 *
 * Proves, against the real governor + tool factory, the "one heavy loop at a
 * time" semantics that separate callable AGENTS from parallel subagents.
 */
import { describe, it, expect } from "vitest";
import {
  AgentDelegationGovernor,
  buildCallableAgentTools,
  clampMaxDelegationsPerRun,
  MAX_DELEGATIONS_PER_RUN_BOUNDS,
  type CallableAgentSpec,
  type NestedAgentRunner,
} from "../src/agent-delegation.js";
import { cancelChildTask, createChildTaskRegistry } from "../src/child-tasks.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const infra: CallableAgentSpec = {
  slug: "infra-doctor",
  name: "Infra Doctor",
  description: "diag",
  systemPrompt: "",
};

function runner(order: string[], workMs = 30): NestedAgentRunner {
  return async ({ spec, question }) => {
    order.push(`start:${question}`);
    await sleep(workMs);
    order.push(`end:${question}`);
    return { text: `${spec.name}:${question}` };
  };
}

describe("A2A delegation governor", () => {
  it("call → pause → return: execute resolves with the callee result", async () => {
    const g = new AgentDelegationGovernor({ ownerSlug: "xyne-doctor" });
    const [tool] = buildCallableAgentTools([infra], g, runner([]));
    const res = await tool.execute("c1", { task: "check" });
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toBe("Infra Doctor:check");
  });

  it("concurrency = 1: two calls in one turn SERIALIZE (no interleave)", async () => {
    const order: string[] = [];
    const g = new AgentDelegationGovernor({ ownerSlug: "xyne-doctor", maxDelegationsPerRun: 5 });
    const [tool] = buildCallableAgentTools([infra], g, runner(order, 40));
    await Promise.all([tool.execute("a", { task: "A" }), tool.execute("b", { task: "B" })]);
    // Serial ⇒ first fully ends before the second starts.
    expect(order).toEqual(["start:A", "end:A", "start:B", "end:B"]);
  });

  it("concurrency = Infinity: two calls in one turn RUN IN PARALLEL (interleave)", async () => {
    const order: string[] = [];
    const g = new AgentDelegationGovernor({
      ownerSlug: "xyne",
      maxDelegationsPerRun: 5,
      concurrency: Number.POSITIVE_INFINITY,
    });
    const [tool] = buildCallableAgentTools([infra], g, runner(order, 40));
    await Promise.all([tool.execute("a", { task: "A" }), tool.execute("b", { task: "B" })]);
    // Parallel ⇒ both start before either ends.
    expect(order.slice(0, 2).sort()).toEqual(["start:A", "start:B"]);
    expect(order).toHaveLength(4);
  });

  it("unlimited concurrency still honours the per-run budget", async () => {
    const order: string[] = [];
    const g = new AgentDelegationGovernor({
      ownerSlug: "xyne",
      maxDelegationsPerRun: 1,
      concurrency: Number.POSITIVE_INFINITY,
    });
    const [tool] = buildCallableAgentTools([infra], g, runner(order, 10));
    const results = await Promise.all([tool.execute("a", { task: "A" }), tool.execute("b", { task: "B" })]);
    // One runs, the other is refused as tool output (never thrown).
    expect(results.filter((r) => r.isError)).toHaveLength(1);
    expect(order.filter((o) => o.startsWith("start:"))).toHaveLength(1);
  });

  it("childGovernor inherits the parent's concurrency", () => {
    const g = new AgentDelegationGovernor({
      ownerSlug: "xyne",
      maxDepth: 2,
      concurrency: Number.POSITIVE_INFINITY,
    });
    expect(g.childGovernor("infra-doctor").concurrency).toBe(Number.POSITIVE_INFINITY);
  });

  it("depth cap = 1: a delegated agent is handed zero delegate tools", () => {
    const g = new AgentDelegationGovernor({ ownerSlug: "xyne-doctor", maxDepth: 1 });
    const child = g.childGovernor("infra-doctor"); // depth 1
    expect(child.canExposeDelegationTools()).toBe(false);
    expect(buildCallableAgentTools([infra], child, runner([]))).toHaveLength(0);
  });

  it("count budget: delegations past the per-run cap are refused", async () => {
    const g = new AgentDelegationGovernor({ ownerSlug: "xyne-doctor", maxDelegationsPerRun: 1 });
    const [tool] = buildCallableAgentTools([infra], g, runner([]));
    const ok = await tool.execute("1", { task: "x" });
    const refused = await tool.execute("2", { task: "y" });
    expect(ok.isError).toBeFalsy();
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toMatch(/budget exhausted/);
  });

  it("cycle guard: an agent cannot delegate to itself", async () => {
    const g = new AgentDelegationGovernor({ ownerSlug: "xyne-doctor", maxDepth: 2, maxDelegationsPerRun: 5 });
    const self: CallableAgentSpec = { slug: "xyne-doctor", name: "Xyne Doctor", description: "", systemPrompt: "" };
    const [tool] = buildCallableAgentTools([self], g, runner([]));
    const res = await tool.execute("s", { task: "loop" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/cycle guard/);
  });
});


describe("clampMaxDelegationsPerRun (config → budget)", () => {
  const { MIN, MAX, DEFAULT } = MAX_DELEGATIONS_PER_RUN_BOUNDS;

  it("falls back to DEFAULT for unset / invalid values", () => {
    for (const v of [undefined, null, "", "abc", NaN, 2.5, {}, [], true]) {
      expect(clampMaxDelegationsPerRun(v as unknown)).toBe(DEFAULT);
    }
  });

  it("passes through valid in-range integers, including numeric strings", () => {
    expect(clampMaxDelegationsPerRun(6)).toBe(6);
    expect(clampMaxDelegationsPerRun(10)).toBe(10);
    expect(clampMaxDelegationsPerRun("8")).toBe(8);
  });

  it("clamps out-of-range values to [MIN, MAX]", () => {
    expect(clampMaxDelegationsPerRun(0)).toBe(MIN);
    expect(clampMaxDelegationsPerRun(-4)).toBe(MIN);
    expect(clampMaxDelegationsPerRun(9999)).toBe(MAX);
  });

  it("a configured budget actually raises the governor cap", async () => {
    const g = new AgentDelegationGovernor({
      ownerSlug: "orchestrator",
      maxDelegationsPerRun: clampMaxDelegationsPerRun("6"),
    });
    const [tool] = buildCallableAgentTools([infra], g, runner([]));
    for (let i = 0; i < 6; i++) {
      const ok = await tool.execute(`c${i}`, { task: `t${i}` });
      expect(ok.isError).toBeFalsy();
    }
    const refused = await tool.execute("c6", { task: "t6" });
    expect(refused.isError).toBeTruthy();
    expect(refused.content[0].text).toMatch(/budget exhausted/);
  });
});

describe("A2A delegation controls", () => {
  const registry = () => createChildTaskRegistry();

  it("exposes run_in_background only when a registry is wired", () => {
    const g = () => new AgentDelegationGovernor({ ownerSlug: "xyne" });
    const props = (tool: { parameters: unknown }) =>
      Object.keys((tool.parameters as { properties: Record<string, unknown> }).properties);

    const [withReg] = buildCallableAgentTools([infra], g(), runner([]), { registry: registry() });
    const [without] = buildCallableAgentTools([infra], g(), runner([]));
    expect(props(withReg!)).toContain("run_in_background");
    expect(props(without!)).not.toContain("run_in_background");
    // The follow-up handle is always available; it needs no run-level wiring.
    expect(props(without!)).toContain("session_id");
  });

  it("run_in_background returns an ack and registers the task", async () => {
    const g = new AgentDelegationGovernor({ ownerSlug: "xyne" });
    const reg = registry();
    const [tool] = buildCallableAgentTools([infra], g, runner([], 20), { registry: reg });

    const res = await tool!.execute("call-1", { task: "slow", run_in_background: true });
    expect(res.content[0]!.text).toContain("in the background");
    expect(res.details["taskId"]).toBe("call-1");

    const task = reg.get("call-1");
    expect(task?.kind).toBe("agent");
    expect(task?.name).toBe("infra-doctor");
    await task!.promise;
    await new Promise((r) => setTimeout(r, 0));
    expect(task!.status).toBe("completed");
    expect(task!.result).toContain("Infra Doctor:slow");
  });

  it("ignores run_in_background when no registry is wired and runs blocking", async () => {
    const g = new AgentDelegationGovernor({ ownerSlug: "xyne" });
    const [tool] = buildCallableAgentTools([infra], g, runner([], 5));
    const res = await tool!.execute("call-1", { task: "x", run_in_background: true });
    expect(res.content[0]!.text).toContain("Infra Doctor:x");
  });

  it("passes a valid session_id through and surfaces the returned handle", async () => {
    const g = new AgentDelegationGovernor({ ownerSlug: "xyne" });
    let seen: string | undefined = "unset";
    const followUpRunner: NestedAgentRunner = async ({ followUpId }) => {
      seen = followUpId;
      return { text: "answer", followUpId: "handle-2" };
    };
    const [tool] = buildCallableAgentTools([infra], g, followUpRunner);

    const res = await tool!.execute("c1", { task: "q", session_id: "handle-1" });
    expect(seen).toBe("handle-1");
    expect(res.details["session_id"]).toBe("handle-2");
    expect(res.content[0]!.text).toContain('session_id: "handle-2"');
  });

  it("drops a malformed session_id instead of failing the call", async () => {
    const g = new AgentDelegationGovernor({ ownerSlug: "xyne" });
    let seen: string | undefined = "unset";
    const followUpRunner: NestedAgentRunner = async ({ followUpId }) => {
      seen = followUpId;
      return { text: "answer" };
    };
    const [tool] = buildCallableAgentTools([infra], g, followUpRunner);

    const res = await tool!.execute("c1", { task: "q", session_id: "../../etc/passwd" });
    expect(seen).toBeUndefined();
    expect(res.isError).toBeFalsy();
    expect(res.content[0]!.text).toBe("answer");
  });

  it("omits the follow-up footer when the runner returns no handle", async () => {
    const g = new AgentDelegationGovernor({ ownerSlug: "xyne" });
    const [tool] = buildCallableAgentTools([infra], g, runner([]));
    const res = await tool!.execute("c1", { task: "q" });
    expect(res.content[0]!.text).not.toContain("Follow-up");
    expect(res.details["session_id"]).toBeUndefined();
  });

  it("stopping a backgrounded delegation aborts that callee's signal", async () => {
    const g = new AgentDelegationGovernor({ ownerSlug: "xyne" });
    const reg = registry();
    let aborted = false;
    const watchingRunner: NestedAgentRunner = async ({ signal }) => {
      signal?.addEventListener("abort", () => { aborted = true; });
      await new Promise((r) => setTimeout(r, 30));
      return { text: "late" };
    };
    const [tool] = buildCallableAgentTools([infra], g, watchingRunner, { registry: reg });

    await tool!.execute("call-1", { task: "slow", run_in_background: true });
    await new Promise((r) => setTimeout(r, 5));
    cancelChildTask(reg, "call-1");
    expect(aborted).toBe(true);
    expect(reg.get("call-1")!.status).toBe("cancelled");
  });

  it("a backgrounded delegation still spends the run budget", async () => {
    const g = new AgentDelegationGovernor({ ownerSlug: "xyne", maxDelegationsPerRun: 1 });
    const reg = registry();
    const [tool] = buildCallableAgentTools([infra], g, runner([], 5), { registry: reg });

    await tool!.execute("call-1", { task: "one", run_in_background: true });
    const second = await tool!.execute("call-2", { task: "two", run_in_background: true });
    expect(second.isError).toBe(true);
    expect(second.content[0]!.text).toMatch(/budget/i);
  });
});

describe("A2A background failures stay observable", () => {
  it("emits a failed event when a detached delegation throws", async () => {
    const events: string[] = [];
    const g = new AgentDelegationGovernor({
      ownerSlug: "xyne",
      onEvent: (ev) => events.push(ev.kind),
    });
    const reg = createChildTaskRegistry();
    const boom: NestedAgentRunner = async () => { throw new Error("callee exploded"); };
    const [tool] = buildCallableAgentTools([infra], g, boom, { registry: reg });

    await tool!.execute("call-1", { task: "x", run_in_background: true });
    const task = reg.get("call-1")!;
    await task.promise.catch(() => {});
    await new Promise((r) => setTimeout(r, 0));

    expect(events).toContain("failed");
    expect(task.status).toBe("error");
    expect(task.error).toBe("callee exploded");
  });
});
