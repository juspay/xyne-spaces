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
  type CallableAgentSpec,
  type NestedAgentRunner,
} from "../src/agent-delegation.js";

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
