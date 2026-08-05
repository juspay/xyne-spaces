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
  buildOrchestratorCallableAgentTool,
  XYNE_LENS_PRODUCTION_BRIEF_CONTRACT,
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

const lens: CallableAgentSpec = {
  slug: "xyne-lens",
  name: "Xyne Lens",
  description: "sealed renderer",
  systemPrompt: "",
  inputContract: XYNE_LENS_PRODUCTION_BRIEF_CONTRACT,
};

const gravityBrief = {
  title: "Gravity in orbit",
  audience: "Curious high-school students",
  learningObjective: "Orbit is continuous free fall, not absence of gravity.",
  durationSeconds: 30,
  visualStyle: "Clean blue and violet vectors with large labels.",
  claims: [{
    id: "gravity",
    statement: "Gravity supplies the inward acceleration for a circular orbit.",
    evidence: "Newtonian mechanics: centripetal acceleration points toward the center.",
  }],
  beats: [
    { id: "hook", purpose: "Contrast a fall with an orbit.", visual: "A ball falls beside a small Earth." },
    { id: "mechanism", purpose: "Show the inward acceleration.", visual: "An arrow points from an orbiting satellite to Earth.", claimIds: ["gravity"] },
    { id: "takeaway", purpose: "Land the key idea.", visual: "Satellite remains in a circular path with a concise takeaway label.", claimIds: ["gravity"] },
  ],
  acceptanceCriteria: ["The inward gravity vector remains attached to the satellite."],
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

  it("threads the wrapper tool call id into the nested agent trace", async () => {
    const g = new AgentDelegationGovernor({ ownerSlug: "xyne-doctor" });
    let receivedParentToolCallId: string | undefined;
    const nested: NestedAgentRunner = async ({ parentToolCallId }) => {
      receivedParentToolCallId = parentToolCallId;
      return { text: "done" };
    };
    const [tool] = buildCallableAgentTools([infra], g, nested);
    await tool.execute("doctor-tool-call-42", { task: "render" });
    expect(receivedParentToolCallId).toBe("doctor-tool-call-42");
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

  it("gives a brief-contract callee a structured parent-facing schema and compiled research handoff", async () => {
    const g = new AgentDelegationGovernor({ ownerSlug: "xyne-doctor" });
    let receivedQuestion = "";
    const nested: NestedAgentRunner = async ({ question }) => {
      receivedQuestion = question;
      return { text: "delivered" };
    };
    const [tool] = buildCallableAgentTools([lens], g, nested);
    const schema = tool.parameters as { required: string[]; properties: Record<string, unknown> };
    expect(schema.required).toEqual(["brief"]);
    expect(schema.properties.brief).toBeDefined();

    const result = await tool.execute("lens-call", { brief: gravityBrief });
    expect(result.isError).toBeFalsy();
    expect(receivedQuestion).toContain("Animation Production Brief v1");
    expect(receivedQuestion).toContain("centripetal acceleration");
    expect(receivedQuestion).toContain("\"beats\"");
  });

  it("rejects an incomplete Lens brief before starting a child run", async () => {
    const g = new AgentDelegationGovernor({ ownerSlug: "xyne-doctor" });
    const nested: NestedAgentRunner = async () => {
      throw new Error("must not run");
    };
    const [tool] = buildCallableAgentTools([lens], g, nested);
    const result = await tool.execute("lens-call", { brief: { title: "Missing everything" } });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/brief\.audience/);
    expect(g.delegationsUsed).toBe(0);
  });

  it("lets orchestrator-tier parents use the same Lens brief contract", async () => {
    const g = new AgentDelegationGovernor({ ownerSlug: "orchestrator" });
    let receivedQuestion = "";
    const nested: NestedAgentRunner = async ({ question }) => {
      receivedQuestion = question;
      return { text: "done" };
    };
    const [tool] = buildOrchestratorCallableAgentTool(
      [{ ...lens, paramName: "brief", paramDescription: "brief", identityMode: "user", progressLabels: [] }],
      g,
      async () => lens,
      nested,
    );
    const schema = tool.parameters as { required: string[]; properties: Record<string, unknown> };
    expect(schema.required).toEqual(["agentSlug"]);
    expect(schema.properties.brief).toBeDefined();

    const result = await tool.execute("lens-call", { agentSlug: "xyne-lens", brief: gravityBrief });
    expect(result.isError).toBeFalsy();
    expect(receivedQuestion).toContain("Gravity in orbit");
  });
});
