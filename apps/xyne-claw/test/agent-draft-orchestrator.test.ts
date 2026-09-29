import { describe, expect, it } from "vitest";
import type { AgentDraftBody, ClawDraftRequest, DraftPick } from "xyne-claw-shared";
import { validateSystemPromptContract } from "xyne-claw-shared";
import { AuthoringLlmError } from "../src/authoring/authoring-llm.js";
import { normalizeDecision, type ClassifyDecision } from "../src/authoring/classify.js";
import {
  CAPABILITY_WAIT_MS,
  replaceSection,
  runDraftTurn,
  type DraftDeps,
} from "../src/authoring/draft-orchestrator.js";
import {
  finishInstructions,
  type InstructionsInput,
  type InstructionsResult,
} from "../src/authoring/instructions.js";
import { resolveJudgement, type JudgedCapabilities } from "../src/authoring/judge.js";

const request = (over: Partial<ClawDraftRequest> = {}): ClawDraftRequest => ({
  draftId: "d1",
  turnId: "t1",
  userId: "u1",
  message: "Every weekday at 9am, brief me on my DMs and tickets.",
  history: [],
  canvas: {
    name: "",
    handle: "",
    description: "",
    instructions: "",
    permissionMode: "ask-first",
    schedule: null,
    capabilities: [],
  },
  userOwned: [],
  timezone: "Asia/Kolkata",
  now: "2026-09-29T09:00:00+05:30",
  catalog: {
    subagents: [{ name: "spaces", description: "Reads Spaces" }],
    integrations: [
      { slug: "xyne-spaces", label: "Xyne Spaces", kind: "mcp", readTools: [{ name: "list_dms", description: "", riskLevel: "read" }], writeTools: [] },
      { slug: "custom:web-search", label: "Web Search", kind: "builtin", readTools: [{ name: "web_search", description: "", riskLevel: "read" }], writeTools: [] },
    ],
  },
  skillCandidates: [],
  knowledgeCandidates: [],
  ...over,
});

const pick = (hub: DraftPick["hub"], id: string, label = id): DraftPick => ({
  hub,
  id,
  label,
  confidence: 0.9,
  reason: "reads DMs",
});

const DRAFT: ClassifyDecision = {
  mode: "draft",
  reply: "",
  fields: ["name", "handle", "description", "instructions", "tools", "skills", "knowledge", "permission", "schedule"],
  name: "Weekday DM Brief",
  handle: "weekday-dm-brief",
  description: "Sends a prioritized DM brief each weekday.",
  permission: { mode: "ask-first", reason: "It sends messages." },
  schedule: { cron: "0 9 * * 1-5", label: "Weekdays at 9:00 AM", task: "Send my brief" },
  capabilityQuery: "read DMs and tickets",
  capabilityAdds: [],
  capabilityRemovals: [],
  instructionsBrief: "Brief the user on DMs and tickets every weekday.",
  ack: "Drafted a weekday brief agent.",
};

const GOOD_PROMPT =
  "You are the brief agent.\n## Operational Workflow\n1. Read DMs.\n2. Send a brief.\n## Guardrails\n- Never send without asking.";

const judged = (bound: DraftPick[], suggested: DraftPick[] = []): JudgedCapabilities => ({
  hubs: {} as JudgedCapabilities["hubs"],
  bound,
  suggested,
});

interface Rig {
  deps: DraftDeps;
  events: AgentDraftBody[];
  clock: { t: number };
}

function rig(over: Partial<DraftDeps> = {}): Rig {
  const clock = { t: 1_000 };
  const deps: DraftDeps = {
    classify: async () => DRAFT,
    judge: async () => judged([pick("mcp", "xyne-spaces", "Xyne Spaces")]),
    instructions: async (_input: InstructionsInput, onDelta): Promise<InstructionsResult> => {
      onDelta("You are the brief agent.");
      return { text: GOOD_PROMPT, contract: { ok: true }, repaired: false };
    },
    now: () => (clock.t += 10),
    ...over,
  };
  return { deps, events: [], clock };
}

const names = (events: AgentDraftBody[]): string[] => events.map((e) => e.event);
const run = (input: ClawDraftRequest, r: Rig, signal = new AbortController().signal) =>
  runDraftTurn(input, (body) => r.events.push(body), signal, r.deps);

describe("runDraftTurn", () => {
  it("drafts a first canvas: identity first, then capabilities and streamed instructions, then done", async () => {
    const r = rig();
    await run(request(), r);
    const order = names(r.events);
    expect(order[0]).toBe("started");
    expect(order[1]).toBe("mode");
    expect(order.indexOf("identity")).toBeLessThan(order.indexOf("instructions.delta"));
    expect(order).toContain("permission");
    expect(order).toContain("schedule");
    expect(order).toContain("capabilities");
    expect(order.indexOf("instructions.done")).toBeGreaterThan(order.indexOf("instructions.delta"));
    expect(order.at(-1)).toBe("done");
    const schedule = r.events.find((e) => e.event === "schedule");
    expect(schedule).toMatchObject({ op: "set", cron: "0 9 * * 1-5", timezone: "Asia/Kolkata" });
    const done = r.events.at(-1);
    expect(done).toMatchObject({ event: "done", status: "completed" });
    expect((done as { timings: { firstFieldMs?: number } }).timings.firstFieldMs).toBeDefined();
  });

  it("answers a vague ask with one question and never calls the judge's result", async () => {
    let judgeAborted = false;
    const r = rig({
      classify: async () => ({ ...DRAFT, mode: "ask", reply: "What job should it do?", fields: [] }),
      judge: (_input, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            judgeAborted = true;
            reject(new AuthoringLlmError("aborted", "cancelled"));
          });
        }),
    });
    await run(request({ message: "make me an agent for my team please" }), r);
    expect(names(r.events)).toEqual(["started", "mode", "reply.delta", "done"]);
    expect(r.events[2]).toMatchObject({ text: "What job should it do?" });
    expect(judgeAborted).toBe(true);
  });

  it("does not start the judge for a bare 'make an agent'", async () => {
    let judgeCalls = 0;
    const r = rig({
      classify: async () => ({ ...DRAFT, mode: "ask", reply: "Which job?", fields: [] }),
      judge: async () => {
        judgeCalls += 1;
        return judged([]);
      },
    });
    await run(request({ message: "make an agent" }), r);
    expect(judgeCalls).toBe(0);
  });

  it("appends late tool picks to the instructions as a section", async () => {
    let releaseJudge: (value: JudgedCapabilities) => void = () => {};
    let instructionsSaw: string[] = [];
    const r = rig({
      judge: () => new Promise((resolve) => (releaseJudge = resolve)),
      instructions: async (input, onDelta) => {
        instructionsSaw = input.capabilities.map((c) => c.id);
        onDelta("You are the brief agent.");
        // The judge lands while the instructions are still being written.
        releaseJudge(judged([pick("mcp", "xyne-spaces", "Xyne Spaces")]));
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { text: GOOD_PROMPT, contract: { ok: true }, repaired: false };
      },
    });
    const wait = CAPABILITY_WAIT_MS;
    expect(wait).toBeGreaterThan(0);
    // Force the "judge not ready yet" path by racing past the wait.
    const original = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void, ms?: number) =>
      original(fn, ms === CAPABILITY_WAIT_MS ? 0 : ms)) as typeof setTimeout;
    try {
      await run(request(), r);
    } finally {
      globalThis.setTimeout = original;
    }
    expect(instructionsSaw).toEqual([]);
    const section = r.events.find((e) => e.event === "instructions.section");
    expect(section).toMatchObject({ heading: "When to use each tool" });
    const done = r.events.find((e) => e.event === "instructions.done") as { text: string };
    expect(done.text).toContain("## When to use each tool");
    expect(done.text).toContain("Xyne Spaces");
  });

  it("gives the instructions the tools that landed within the wait", async () => {
    let instructionsSaw: string[] = [];
    const r = rig({
      instructions: async (input, onDelta) => {
        instructionsSaw = input.capabilities.map((c) => c.id);
        onDelta("x");
        return { text: GOOD_PROMPT, contract: { ok: true }, repaired: false };
      },
    });
    await run(request(), r);
    expect(instructionsSaw).toEqual(["xyne-spaces"]);
    expect(names(r.events)).not.toContain("instructions.section");
  });

  it("keeps going when the judge fails: a warning, no tools, partial status", async () => {
    const r = rig({ judge: async () => { throw new AuthoringLlmError("http", "boom"); } });
    await run(request(), r);
    expect(names(r.events)).toContain("warning");
    expect(names(r.events)).not.toContain("capabilities");
    expect(r.events.at(-1)).toMatchObject({ event: "done", status: "partial" });
  });

  it("falls back to a template when instructions fail, and the result still passes the contract", async () => {
    const r = rig({
      instructions: async () => {
        throw new AuthoringLlmError("timeout", "slow");
      },
    });
    await run(request(), r);
    const done = r.events.find((e) => e.event === "instructions.done") as {
      text: string;
      contract: { ok: boolean };
    };
    expect(validateSystemPromptContract(done.text).ok).toBe(true);
    expect(done.contract.ok).toBe(true);
    expect(names(r.events)).toContain("warning");
  });

  it("uses a simple draft when classify fails", async () => {
    const r = rig({ classify: async () => { throw new AuthoringLlmError("http", "down"); } });
    await run(request(), r);
    const identity = r.events.find((e) => e.event === "identity") as { name?: string };
    expect(identity.name).toBeTruthy();
    expect(names(r.events)).toContain("instructions.done");
  });

  it("does not touch fields the user owns and skips their capability rows", async () => {
    const r = rig();
    const input = request({
      userOwned: ["instructions", "tools"],
      canvas: { ...request().canvas, name: "Mine", instructions: "My own prompt", handle: "mine" },
    });
    await run(input, r);
    expect(names(r.events)).not.toContain("instructions.delta");
    expect(names(r.events)).not.toContain("instructions.done");
  });

  it("stops and reports cancelled when the client disconnects", async () => {
    const abort = new AbortController();
    const r = rig({
      classify: (_input, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new AuthoringLlmError("aborted", "cancelled")));
          abort.abort();
        }),
    });
    await run(request(), r, abort.signal);
    expect(r.events.at(-1)).toMatchObject({ event: "done", status: "cancelled" });
  });

  it("drops read-only picks' write access and skips items already on the canvas", async () => {
    const r = rig({
      classify: async () => ({ ...DRAFT, permission: { mode: "read-only", reason: "Only reads." } }),
      judge: async () =>
        judged([
          { ...pick("mcp", "xyne-spaces", "Xyne Spaces"), access: "write" },
          pick("subagent", "spaces"),
        ]),
    });
    const input = request({
      canvas: { ...request().canvas, capabilities: [{ hub: "subagent", id: "spaces", label: "spaces" }] },
    });
    await run(input, r);
    const caps = r.events.find((e) => e.event === "capabilities") as { bound: DraftPick[] };
    expect(caps.bound.map((p) => p.id)).toEqual(["xyne-spaces"]);
    expect(caps.bound[0]?.access).toBe("read");
  });

  it("removes a named capability on an edit without calling the judge for it", async () => {
    const r = rig({
      classify: async () => ({
        mode: "edit",
        reply: "",
        fields: ["tools"],
        capabilityQuery: "",
        capabilityAdds: [],
        capabilityRemovals: [{ hub: "builtin", id: "custom:web-search" }],
        instructionsBrief: "",
        ack: "Removed web search.",
      }),
      judge: async () => judged([]),
    });
    const input = request({
      message: "remove web search",
      canvas: {
        ...request().canvas,
        name: "Brief",
        instructions: GOOD_PROMPT,
        capabilities: [{ hub: "builtin", id: "custom:web-search", label: "Web Search" }],
      },
    });
    await run(input, r);
    const caps = r.events.find((e) => e.event === "capabilities") as {
      remove: Array<{ id: string }>;
    };
    expect(caps.remove).toEqual([{ hub: "builtin", id: "custom:web-search" }]);
  });
});

describe("normalizeDecision", () => {
  const raw = {
    mode: "draft",
    name: "Weekday DM Brief",
    handle: "Weekday DM Brief",
    description: "x".repeat(400),
    permission: { mode: "banana", reason: "r" },
    schedule: { cron: "every day at nine", label: "x", task: "y" },
    fields: ["name", "instructions", "nonsense"],
  };

  it("cleans the handle, caps the description, defaults an unknown permission, drops a non-cron schedule", () => {
    const d = normalizeDecision(raw, request());
    expect(d.handle).toBe("weekday-dm-brief");
    expect(d.description?.length).toBe(200);
    expect(d.permission?.mode).toBe("ask-first");
    expect(d.schedule).toBeUndefined();
  });

  it("never writes a field the user owns", () => {
    const d = normalizeDecision({ ...raw, name: "New Name" }, request({ userOwned: ["name", "handle"] }));
    expect(d.name).toBeUndefined();
    expect(d.handle).toBeUndefined();
    expect(d.fields).not.toContain("name");
  });

  it("treats an edit on an empty canvas as a first draft, and ignores removals not on the canvas", () => {
    const d = normalizeDecision(
      { mode: "edit", fields: ["name"], capabilityRemovals: [{ hub: "mcp", id: "ghost" }] },
      request(),
    );
    expect(d.mode).toBe("draft");
    expect(d.capabilityRemovals).toEqual([]);
  });
});

describe("resolveJudgement", () => {
  const input = {
    intent: "brief me on my DMs and search the web for news",
    catalog: request().catalog,
    skills: [{ slug: "brief", name: "Brief", description: "" }],
    knowledge: [{ id: "c1", name: "Team docs" }],
    hubs: ["mcp", "builtin", "subagent", "skill", "knowledge"] as const,
  };

  it("drops invented ids and applies the thresholds", () => {
    const out = resolveJudgement(
      {
        mcp: [
          { id: "xyne-spaces", confidence: 0.95, reason: "reads DMs", access: "read" },
          { id: "slack", confidence: 1, reason: "made up" },
        ],
        builtin: [{ id: "custom:web-search", confidence: 0.7, reason: "news" }],
        subagent: [{ id: "spaces", confidence: 0.8, reason: "helper" }],
        skill: [{ id: "brief", confidence: 0.6, reason: "maybe" }],
        knowledge: [{ id: "c1", confidence: 0.9, reason: "docs" }],
      },
      input,
    );
    expect(out.bound.map((p) => p.id).sort()).toEqual(["c1", "custom:web-search", "xyne-spaces"].sort());
    // Subagents at 0.8 are only suggested; a skill at 0.6 is only suggested.
    expect(out.suggested.map((p) => p.id).sort()).toEqual(["brief", "spaces"]);
    expect(out.bound.find((p) => p.id === "xyne-spaces")?.label).toBe("Xyne Spaces");
  });

  it("accepts nothing when the catalog list is empty", () => {
    const out = resolveJudgement(
      { skill: [{ id: "made-up", confidence: 1, reason: "" }] },
      { ...input, skills: [] },
    );
    expect(out.bound).toEqual([]);
    expect(out.suggested).toEqual([]);
  });

  it("flags a product the user has not connected", () => {
    const out = resolveJudgement(
      { mcp: [{ id: "xyne-spaces", confidence: 1, reason: "r", access: "write" }] },
      {
        ...input,
        catalog: {
          ...input.catalog,
          integrations: input.catalog.integrations.map((i) =>
            i.slug === "xyne-spaces" ? { ...i, requiresConnection: "xyne-spaces" } : i,
          ),
        },
      },
    );
    expect(out.bound[0]).toMatchObject({ access: "write", requiresConnection: "xyne-spaces" });
  });
});

describe("instructions helpers", () => {
  it("repairs a prompt that misses the Workflow and Guardrails sections", () => {
    const out = finishInstructions("You are the brief agent. Be calm and short.", {
      permissionMode: "ask-first",
      name: "Brief",
    });
    expect(out.repaired).toBe(true);
    expect(out.contract.ok).toBe(true);
  });

  it("replaces an existing section instead of duplicating it", () => {
    const text = "## A\nbody\n\n## When to use each tool\nold\n\n## Guardrails\n- Never x.";
    const out = replaceSection(text, "When to use each tool", "## When to use each tool\n- Use Y.");
    expect(out).toContain("- Use Y.");
    expect(out).not.toContain("old");
    expect(out).toContain("## Guardrails");
    expect(out.match(/## When to use each tool/g)).toHaveLength(1);
  });
});
