import { describe, expect, it } from "vitest";
import type { AgentDraftBody, ClawDraftRequest, DraftPick } from "xyne-claw-shared";
import { validateSystemPromptContract } from "xyne-claw-shared";
import { AuthoringLlmError } from "../src/authoring/authoring-llm.js";
import {
  fillDraftIdentity,
  isHollowDraft,
  unfoldFieldOps,
  nameFromMessage,
  normalizeDecision,
  repairCron,
  zonedLocalToIso,
  type ClassifyDecision,
} from "../src/authoring/classify.js";
import {
  CAPABILITY_WAIT_MS,
  capabilityAck,
  crowdedNote,
  replaceSection,
  runDraftTurn,
  toolLinesIn,
  type DraftDeps,
} from "../src/authoring/draft-orchestrator.js";
import {
  buildInstructionsMessages,
  finishInstructions,
  plainInstructions,
  templateInstructions,
  toolsSection,
  type InstructionsInput,
  type InstructionsResult,
} from "../src/authoring/instructions.js";
import { buildJudgePrompt, catalogPicks, resolveJudgement, type JudgeInput, type JudgedCapabilities } from "../src/authoring/judge.js";
import { normalizeQuestions, normalizeSuggestions } from "../src/authoring/questions.js";
import { parseSearchText, type WebLookup } from "../src/authoring/web-lookup.js";

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
  schedule: { kind: "repeat", cron: "0 9 * * 1-5", label: "Weekdays at 9:00 AM", task: "Send my brief" },
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
    searchReady: () => true,
    search: async () => ({ ok: true, text: "[1] Weather\nURL: https://w.example", sources: [{ title: "Weather", url: "https://w.example" }] }),
    talk: async (_messages, onDelta) => {
      onDelta("It is ");
      onDelta("sunny.");
      return { text: "It is sunny.", cutOff: false };
    },
    followups: async () => ({ suggestions: [], questions: [] }),
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
    expect(section).toMatchObject({ heading: "Tools" });
    const done = r.events.find((e) => e.event === "instructions.done") as { text: string };
    // Plain text, in front of the rules rather than tacked on at the end.
    expect(done.text).toMatch(/\nTools\n- Xyne Spaces: /);
    expect(done.text.indexOf("Tools")).toBeLessThan(done.text.indexOf("Guardrails"));
    expect(done.text).not.toContain("#");
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
    const text = "You are X.\n\nHow you work\n1. A.\n2. B.\n\nTools\n- Old: gone.\n\nRules\n- Never x.";
    const out = replaceSection(text, "Tools", "Tools\n- Y: new.");
    expect(out).toBe("You are X.\n\nHow you work\n1. A.\n2. B.\n\nTools\n- Y: new.\n\nRules\n- Never x.");
  });

  it("replaces an older prompt's markdown tools section under its old title", () => {
    const text = "## A\nbody\n\n## When to use each tool\nold\n\n## Guardrails\n- Never x.";
    const out = replaceSection(text, "Tools", "Tools\n- Y: new.");
    expect(out).toBe("## A\nbody\n\nTools\n- Y: new.\n\n## Guardrails\n- Never x.");
  });

  it("adds a missing section in front of the rules, or at the end", () => {
    const text = "You are X.\n\nHow you work\n1. A.\n2. B.\n\nRules\n- Never x.";
    expect(replaceSection(text, "Tools", "Tools\n- Y: new.", ["Rules"])).toBe(
      "You are X.\n\nHow you work\n1. A.\n2. B.\n\nTools\n- Y: new.\n\nRules\n- Never x.",
    );
    expect(replaceSection("You are X.", "Tools", "Tools\n- Y: new.", ["Rules"])).toBe(
      "You are X.\n\nTools\n- Y: new.",
    );
  });

  it("strips the markdown a writer slips in", () => {
    expect(plainInstructions("## Rules\n* **Never** post.\n- Ask __first__.\n1. Step")).toBe(
      "Rules\n- Never post.\n- Ask first.\n1. Step",
    );
    const out = finishInstructions("```markdown\n## How you work\n1. Read.\n2. Reply.\n\n## Rules\n- **Never** guess.\n```", {
      permissionMode: "ask-first",
      name: "Brief",
    });
    expect(out.text).toBe("How you work\n1. Read.\n2. Reply.\n\nRules\n- Never guess.");
    expect(out.repaired).toBe(false);
  });

  it("keeps each title right above its list", () => {
    expect(plainInstructions("You are X. Be brief.\n\nHow you work\n\n1. Read.\n\nRules\n\n- Never guess.")).toBe(
      "You are X. Be brief.\n\nHow you work\n1. Read.\n\nRules\n- Never guess.",
    );
    // A sentence before a list keeps its blank line.
    expect(plainInstructions("Keep it short.\n\n- One.")).toBe("Keep it short.\n\n- One.");
  });

  it("falls back to a plain template that passes the contract", () => {
    const input: InstructionsInput = {
      name: "Standup Scribe",
      description: "",
      brief: "You summarise the eng team's standup.",
      permissionMode: "ask-first",
      schedule: null,
      capabilities: [{ hub: "mcp", id: "slack", label: "Slack", confidence: 0.9, reason: "Post the summary." }],
    };
    const text = templateInstructions(input);
    expect(text).not.toContain("#");
    expect(text).toContain("\nTools\n- Slack: post the summary.\n");
    expect(validateSystemPromptContract(text).ok).toBe(true);
    expect(finishInstructions(text, input).repaired).toBe(false);
  });

  it("asks the writer for plain text in fixed sections", () => {
    const [system, user] = buildInstructionsMessages({
      name: "Scribe",
      description: "",
      brief: "Summarise standups.",
      permissionMode: "read-only",
      schedule: null,
      capabilities: [],
    });
    expect(system!.content).toMatch(/plain text/);
    expect(system!.content).toMatch(/no # headings, no \*\*/);
    expect(user!.content).not.toMatch(/## /);
  });
});

describe("schedules and custom properties", () => {
  it("repairs the six-field crons fast models write for times with minutes", () => {
    expect(repairCron("0 9 30 * * 1-5")).toBe("30 9 * * 1-5");
    expect(repairCron("0 30 9 * * 1-5")).toBe("30 9 * * 1-5");
    expect(repairCron("0 0 9 * * *")).toBe("0 9 * * *");
    expect(repairCron("30 9 * * 1-5")).toBe("30 9 * * 1-5");
    expect(repairCron("5 9 30 * * 1-5")).toBe("5 9 30 * * 1-5");
  });

  it("reads a one-time schedule as wall-clock time in the user's zone", () => {
    expect(zonedLocalToIso("2026-10-03T09:00", "Asia/Kolkata")).toBe("2026-10-03T03:30:00.000Z");
    expect(zonedLocalToIso("2026-10-03T09:00", "UTC")).toBe("2026-10-03T09:00:00.000Z");
    expect(zonedLocalToIso("Oct 3 9am", "UTC")).toBeNull();
    expect(zonedLocalToIso("2026-10-03T09:00", "Not/AZone")).toBeNull();
  });

  it("keeps a future one-time schedule and drops a past one", () => {
    const future = normalizeDecision(
      { mode: "draft", schedule: { kind: "once", at: "2026-10-03T09:00", label: "Oct 3, 9:00 AM", task: "Post it" } },
      request(),
    );
    expect(future.schedule).toEqual({
      kind: "once",
      at: "2026-10-03T03:30:00.000Z",
      label: "Oct 3, 9:00 AM",
      task: "Post it",
    });
    expect(future.fields).toContain("schedule");

    const past = normalizeDecision(
      { mode: "draft", schedule: { kind: "once", at: "2026-09-01T09:00", label: "x", task: "" } },
      request(),
    );
    expect(past.schedule).toBeUndefined();
  });

  it("keeps typed property ops whose value fits the type, and removals of existing rows only", () => {
    const d = normalizeDecision(
      {
        mode: "edit",
        fields: ["properties"],
        properties: [
          { op: "set", title: "Budget", type: "number", value: "500" },
          { op: "set", title: "Needs Approval", type: "checkbox", value: "yes" },
          { op: "set", title: "Deadline", type: "date", value: "next week" },
          { op: "remove", title: "priority" },
          { op: "remove", title: "Ghost" },
        ],
      },
      request({
        canvas: {
          ...request().canvas,
          name: "Brief",
          instructions: "x",
          customProperties: [{ title: "Priority", type: "text", value: "high" }],
        },
      }),
    );
    expect(d.properties).toEqual([
      { op: "set", title: "Budget", type: "number", value: "500" },
      { op: "set", title: "Needs Approval", type: "checkbox", value: "true" },
      { op: "remove", title: "priority" },
    ]);
  });

  it("streams the schedule and properties before the instructions", async () => {
    const r = rig({
      classify: async () => ({
        ...DRAFT,
        fields: [...DRAFT.fields, "properties"],
        properties: [{ op: "set", title: "Budget", type: "number", value: "500" }],
      }),
    });
    await run(request(), r);
    const order = r.events.map((e) => e.event);
    expect(order.indexOf("properties")).toBeGreaterThan(-1);
    expect(order.indexOf("properties")).toBeLessThan(order.indexOf("instructions.delta"));
    expect(r.events.find((e) => e.event === "schedule")).toMatchObject({ kind: "repeat" });
  });
});

describe("fallback when the planning call fails", () => {
  it("answers small talk instead of rewriting the canvas", async () => {
    const r = rig({
      classify: async () => {
        throw new AuthoringLlmError("http", "fetch failed");
      },
    });
    await run(
      request({ message: "hi", canvas: { ...request().canvas, name: "Digest", instructions: "x" } }),
      r,
    );
    const names = r.events.map((e) => e.event);
    expect(r.events.find((e) => e.event === "mode")).toMatchObject({ mode: "chat" });
    expect(names).not.toContain("instructions.delta");
    expect(names).not.toContain("identity");
    expect(r.events.find((e) => e.event === "reply.delta")).toMatchObject({ text: expect.stringMatching(/^Hi!/) });
  });
});

describe("start over", () => {
  const filled = { ...request().canvas, name: "Morning Brief", instructions: "You are the Morning Brief agent." };

  it("sends the reset mode and a reply, and writes nothing to the canvas", async () => {
    const r = rig({ classify: async () => ({ ...DRAFT, mode: "reset", fields: [], ack: "" }) });
    await run(request({ message: "lets start from clean slate", canvas: filled }), r);
    expect(r.events.find((e) => e.event === "mode")).toMatchObject({ mode: "reset", fields: [] });
    expect(r.events.find((e) => e.event === "ack")).toMatchObject({ text: expect.stringMatching(/^Cleared the canvas/) });
    expect(names(r.events)).not.toContain("identity");
    expect(names(r.events)).not.toContain("capabilities");
    expect(names(r.events)).not.toContain("instructions.delta");
    expect(r.events.at(-1)).toMatchObject({ event: "done", status: "completed" });
  });

  it("clears rather than edits when the planner fails on a start-over message", async () => {
    const r = rig({
      classify: async () => {
        throw new AuthoringLlmError("timeout", "slow");
      },
    });
    await run(request({ message: "lets start from clean slate", canvas: filled }), r);
    expect(r.events.find((e) => e.event === "mode")).toMatchObject({ mode: "reset" });
    expect(names(r.events)).not.toContain("identity");
  });

  it("keeps the reset mode from the planner, with no fields", () => {
    const decision = normalizeDecision(
      { mode: "reset", fields: ["name"], name: "New", ack: "Cleared the canvas." },
      request({ canvas: filled }),
    );
    expect(decision).toMatchObject({ mode: "reset", fields: [], ack: "Cleared the canvas." });
    expect(decision.name).toBeUndefined();
  });
});

describe("blank ack", () => {
  const ackText = (events: AgentDraftBody[]): string | undefined =>
    (events.find((e) => e.event === "ack") as { text: string } | undefined)?.text;

  it("still answers in chat after a first draft", async () => {
    const r = rig({ classify: async () => ({ ...DRAFT, ack: "" }) });
    await run(request(), r);
    expect(ackText(r.events)).toBe("Drafted Weekday DM Brief.");
  });

  it("names the fields an edit changed", async () => {
    const r = rig({
      classify: async () => ({
        mode: "edit",
        reply: "",
        fields: ["name", "handle"],
        name: "Morning Brief",
        handle: "morning-brief",
        capabilityQuery: "",
        capabilityAdds: [],
        capabilityRemovals: [],
        instructionsBrief: "",
        ack: "",
      }),
    });
    await run(
      request({ message: "call it Morning Brief", canvas: { ...request().canvas, name: "Brief", instructions: GOOD_PROMPT } }),
      r,
    );
    expect(ackText(r.events)).toBe("Updated the name and handle.");
  });

  it("does not claim a change when nothing landed", async () => {
    const r = rig({
      classify: async () => ({
        mode: "edit",
        reply: "",
        fields: [],
        capabilityQuery: "",
        capabilityAdds: [],
        capabilityRemovals: [],
        instructionsBrief: "",
        ack: "",
      }),
    });
    await run(
      request({ message: "looks fine", canvas: { ...request().canvas, name: "Brief", instructions: GOOD_PROMPT } }),
      r,
    );
    expect(ackText(r.events)).toBe("Nothing on the canvas needed changing.");
  });
});

describe("fields the user wrote by hand", () => {
  const ackText = (events: AgentDraftBody[]): string | undefined =>
    (events.find((e) => e.event === "ack") as { text: string } | undefined)?.text;
  const filled = { ...request().canvas, name: "Brief", description: "Mine.", instructions: GOOD_PROMPT };
  const edit = (over: Partial<ClassifyDecision>): ClassifyDecision => ({
    mode: "edit",
    reply: "",
    fields: [],
    capabilityQuery: "",
    capabilityAdds: [],
    capabilityRemovals: [],
    instructionsBrief: "",
    ack: "Made the description formal.",
    ...over,
  });

  it("lets an edit rewrite a field the user owns, but not a first draft", () => {
    const raw = { mode: "edit", fields: ["description"], description: "A formal brief." };
    const edited = normalizeDecision(raw, request({ canvas: filled, userOwned: ["description"] }));
    expect(edited.fields).toEqual(["description"]);
    expect(edited.description).toBe("A formal brief.");
    const drafted = normalizeDecision({ ...raw, mode: "draft" }, request({ userOwned: ["description"] }));
    expect(drafted.fields).not.toContain("description");
    expect(drafted.description).toBeUndefined();
  });

  it("writes what an edit asked for over the user's own text", async () => {
    const r = rig({ classify: async () => edit({ fields: ["description"], description: "A formal brief." }) });
    await run(request({ message: "make the description formal", canvas: filled, userOwned: ["description"] }), r);
    expect(r.events).toContainEqual({ event: "identity", description: "A formal brief." });
    expect(ackText(r.events)).toBe("Made the description formal.");
  });

  it("adds a named tool to a row the user filled by hand", async () => {
    const r = rig({
      classify: async () => edit({ fields: ["tools"], capabilityAdds: ["Web Search"], ack: "" }),
      // Only a judge asked about built-in tools can find it.
      judge: async (input: JudgeInput) =>
        judged(input.hubs.includes("builtin") ? [pick("builtin", "custom:web-search", "Web Search")] : []),
    });
    await run(request({ message: "add web search", canvas: filled, userOwned: ["tools"] }), r);
    const caps = r.events.find((e) => e.event === "capabilities") as { bound: DraftPick[] } | undefined;
    expect(caps?.bound.map((p) => p.id)).toEqual(["custom:web-search"]);
  });

  it("leaves a hand-filled tools row alone on a first draft", async () => {
    const r = rig();
    await run(request({ userOwned: ["tools"] }), r);
    const caps = r.events.find((e) => e.event === "capabilities") as { bound: DraftPick[] } | undefined;
    expect(caps?.bound.filter((p) => p.hub === "mcp" || p.hub === "builtin" || p.hub === "subagent") ?? []).toEqual([]);
  });

  it("does not take the model's word for a change when nothing landed", async () => {
    const r = rig({ classify: async () => edit({}) });
    await run(request({ message: "make the description formal", canvas: filled }), r);
    expect(ackText(r.events)).toBe("Nothing on the canvas needed changing.");
  });
});

describe("fallback names", () => {
  it("names the job, not the verb", async () => {
    const r = rig({
      classify: async () => {
        throw new AuthoringLlmError("parse", "LLM returned non-JSON");
      },
    });
    await run(request({ message: "Create a release copilot for the platform team. It reviews PRs." }), r);
    expect(r.events.find((e) => e.event === "identity")).toMatchObject({ name: "Release Copilot" });
  });
});

describe("conversation turns", () => {
  const CHAT: ClassifyDecision = {
    ...DRAFT,
    mode: "chat",
    reply: "Fallback answer.",
    fields: [],
    lookup: ["Bangalore weather today"],
  };
  const replyText = (events: AgentDraftBody[]): string =>
    events
      .filter((e): e is Extract<AgentDraftBody, { event: "reply.delta" }> => e.event === "reply.delta")
      .map((e) => e.text)
      .join("");

  it("searches, streams the answer, then offers changes, and never touches the canvas", async () => {
    let judgeSignal: AbortSignal | null = null;
    const r = rig({
      classify: async () => CHAT,
      judge: (_input, signal) => {
        judgeSignal = signal;
        return new Promise(() => {});
      },
      followups: async () => ({
        suggestions: [{ id: "s1", label: "Draft a weather agent", message: "Draft an agent that sends Bangalore's weather at 8am." }],
        questions: [],
      }),
    });
    await run(request({ message: "What's the weather in Bangalore today?" }), r);
    expect(names(r.events)).toEqual([
      "started",
      "mode",
      "activity",
      "activity",
      "reply.delta",
      "reply.delta",
      "suggestion",
      "done",
    ]);
    expect(r.events[2]).toMatchObject({ status: "running", label: "Searching the web: Bangalore weather today" });
    expect(r.events[3]).toMatchObject({ status: "done", detail: "1 source" });
    expect(replyText(r.events)).toBe("It is sunny.");
    expect(judgeSignal!.aborted).toBe(true);
  });

  it("answers without searching when nothing needs looking up, or search isn't set up", async () => {
    let searched = 0;
    const search = async (): Promise<WebLookup> => {
      searched += 1;
      return { ok: false, reason: "error" };
    };
    const plain = rig({ classify: async () => ({ ...CHAT, lookup: [] }), search });
    await run(request({ message: "What does a triage agent usually do?" }), plain);
    const unset = rig({ classify: async () => CHAT, search, searchReady: () => false });
    await run(request({ message: "Weather in Bangalore?" }), unset);
    expect(searched).toBe(0);
    expect(names(plain.events)).not.toContain("activity");
    expect(names(unset.events)).not.toContain("activity");
    expect(replyText(unset.events)).toBe("It is sunny.");
  });

  it("still answers when the search fails", async () => {
    const r = rig({ classify: async () => CHAT, search: async () => ({ ok: false, reason: "timeout" }) });
    await run(request({ message: "Weather in Bangalore?" }), r);
    expect(r.events.filter((e) => e.event === "activity").at(-1)).toMatchObject({
      status: "failed",
      label: "Couldn't reach web search",
    });
    expect(replyText(r.events)).toBe("It is sunny.");
  });

  it("falls back to the planner's answer when the model can't answer", async () => {
    const r = rig({
      classify: async () => ({ ...CHAT, lookup: [] }),
      talk: async () => {
        throw new AuthoringLlmError("http", "down");
      },
    });
    await run(request({ message: "What is an agent?" }), r);
    expect(replyText(r.events)).toBe("Fallback answer.");
    expect(r.events.at(-1)).toMatchObject({ event: "done", status: "partial" });
  });

  it("says when an answer was cut off", async () => {
    const r = rig({
      classify: async () => ({ ...CHAT, lookup: [] }),
      talk: async (_m, onDelta) => {
        onDelta("Half an ans");
        return { text: "Half an ans", cutOff: true };
      },
    });
    await run(request({ message: "Explain agents" }), r);
    expect(r.events.find((e) => e.event === "warning")).toMatchObject({ stage: "talk" });
  });

  it("shows a question card instead of suggestions when the reply asks the user to choose", async () => {
    const r = rig({
      classify: async () => ({ ...CHAT, lookup: [] }),
      followups: async () => ({
        suggestions: [],
        questions: [
          { id: "q1", label: "Source", question: "Where do tickets come from?", type: "single_choice", options: [{ label: "Jira" }, { label: "Linear" }] },
        ],
      }),
    });
    await run(request({ message: "How would a triage agent work for us?" }), r);
    expect(names(r.events)).toContain("question");
    expect(names(r.events)).not.toContain("suggestion");
  });

  it("skips follow-ups for small talk", async () => {
    let asked = 0;
    const r = rig({
      classify: async () => ({ ...CHAT, lookup: [] }),
      followups: async () => {
        asked += 1;
        return { suggestions: [], questions: [] };
      },
    });
    await run(request({ message: "thanks!" }), r);
    expect(asked).toBe(0);
  });

  it("asks a vague request with a question card", async () => {
    const r = rig({
      classify: async () => ({
        ...DRAFT,
        mode: "ask",
        reply: "Happy to help. A couple of quick choices:",
        fields: [],
        questions: [
          { id: "q1", label: "Job", question: "What should it do?", type: "single_choice", options: [{ label: "Review PRs" }, { label: "Daily digest" }] },
        ],
      }),
    });
    await run(request({ message: "make an agent" }), r);
    expect(names(r.events)).toEqual(["started", "mode", "reply.delta", "question", "done"]);
    expect(r.events[3]).toMatchObject({ id: "t1-q" });
  });

  it("answers a question without the planner instead of rewriting the canvas", async () => {
    const r = rig({
      classify: async () => {
        throw new AuthoringLlmError("timeout", "slow");
      },
    });
    await run(
      request({ message: "What's the weather like in Bangalore?", canvas: { ...request().canvas, name: "Digest", instructions: "x" } }),
      r,
    );
    expect(r.events.find((e) => e.event === "mode")).toMatchObject({ mode: "chat" });
    expect(names(r.events)).not.toContain("instructions.delta");
    const reply = r.events.filter((e) => e.event === "reply.delta").map((e) => (e as { text: string }).text);
    expect(reply.join("")).toBe("It is sunny.");
  });

  it("says it couldn't answer only when the talk model fails too", async () => {
    const r = rig({
      classify: async () => {
        throw new AuthoringLlmError("timeout", "slow");
      },
      talk: async () => ({ text: "", cutOff: false }),
    });
    await run(request({ message: "How can we streamline my mornings?" }), r);
    const reply = r.events.filter((e) => e.event === "reply.delta").map((e) => (e as { text: string }).text);
    expect(reply.join("")).toMatch(/couldn't answer/);
  });

  it("greets without the planner or the talk model", async () => {
    let talked = 0;
    const r = rig({
      classify: async () => {
        throw new AuthoringLlmError("http", "down");
      },
      talk: async () => {
        talked += 1;
        return { text: "Hey", cutOff: false };
      },
    });
    await run(request({ message: "hi", canvas: { ...request().canvas, name: "Digest", instructions: "x" } }), r);
    expect(r.events.find((e) => e.event === "mode")).toMatchObject({ mode: "chat" });
    expect(talked).toBe(0);
    expect(names(r.events)).toEqual(["started", "mode", "reply.delta", "done"]);
  });

  it("never asks questions on a first draft", async () => {
    const r = rig({ classify: async () => ({ ...DRAFT, questions: [] }) });
    await run(request(), r);
    expect(names(r.events)).not.toContain("question");
  });
});

describe("follow-up normalizers", () => {
  it("keeps well-formed questions and drops the options the card adds itself", () => {
    const out = normalizeQuestions([
      {
        label: "Job",
        question: "What should it do?",
        type: "multiple_choice",
        options: [
          { label: "Review PRs", description: "Flags problems" },
          "Daily digest",
          { label: "review prs" },
          { label: "Something else" },
          { label: "Other" },
        ],
      },
      { label: "", question: "No label", options: ["a", "b"] },
      { label: "One", question: "Only one option", options: ["a"] },
      "junk",
    ]);
    expect(out).toEqual([
      {
        id: "q1",
        label: "Job",
        question: "What should it do?",
        type: "multiple_choice",
        options: [{ label: "Review PRs", description: "Flags problems" }, { label: "Daily digest" }],
      },
    ]);
    expect(normalizeQuestions("nope")).toEqual([]);
  });

  it("shortens a long chip label at a word boundary", () => {
    const [q] = normalizeQuestions([
      { label: "Weather capability", question: "Which?", options: ["Now", "Hourly"] },
    ]);
    expect(q!.label).toBe("Weather");
  });

  it("caps suggestions at two and needs a label and a message", () => {
    const out = normalizeSuggestions([
      { label: "Add PR reviews.", message: "Add a PR review step." },
      { label: "Add PR reviews", message: "dup" },
      { label: "No message" },
      { label: "Post to Slack", message: "Post the digest to Slack." },
      { label: "Third", message: "Third one." },
    ]);
    expect(out.map((s) => s.label)).toEqual(["Add PR reviews", "Post to Slack"]);
  });

  it("reads sources out of web search text", () => {
    const parsed = parseSearchText(
      "Found 2 search results:\n\n[1] Bangalore weather\nURL: https://a.example (2026-09-30)\nSunny, 27C\n\n[2] Forecast\nURL: https://b.example\nRain later",
    );
    expect(parsed.sources).toEqual([
      { title: "Bangalore weather", url: "https://a.example" },
      { title: "Forecast", url: "https://b.example" },
    ]);
    expect(parsed.text).toContain("Sunny, 27C");
    expect(parsed.text).not.toContain("Found 2");
  });
});


describe("adding tools from chat", () => {
  const TOOLS_PROMPT = [
    "You are God Agent.",
    "",
    "How you work",
    "1. Read the request.",
    "",
    "Tools",
    "- Orchestrator: coordinate the overall flow.",
    "",
    "Rules",
    "- Never send without asking.",
  ].join("\n");

  const catalog: ClawDraftRequest["catalog"] = {
    subagents: [
      { name: "spaces", description: "Reads Spaces" },
      { name: "github", description: "Reads GitHub" },
    ],
    integrations: [
      { slug: "xyne-spaces", label: "Xyne Spaces", kind: "mcp", readTools: [{ name: "list_dms", description: "", riskLevel: "read" }], writeTools: [{ name: "send_dm", description: "", riskLevel: "write" }] },
      { slug: "jira", label: "Jira", kind: "mcp", readTools: [{ name: "search_issues", description: "", riskLevel: "read" }], writeTools: [] },
      { slug: "figma", label: "Figma", kind: "mcp", requiresConnection: "Figma", readTools: [{ name: "get_file", description: "", riskLevel: "read" }], writeTools: [] },
      { slug: "github", label: "GitHub", kind: "mcp", readTools: [], writeTools: [] },
      { slug: "orchestrator", label: "Orchestrator", kind: "builtin", readTools: [], writeTools: [] },
    ],
  };

  const EDIT: ClassifyDecision = {
    mode: "edit",
    reply: "",
    fields: ["tools"],
    capabilityQuery: "",
    capabilityAdds: [],
    capabilityRemovals: [],
    instructionsBrief: "",
    // The planner claims a result before the tools step runs; it must not reach the chat.
    ack: "Added all MCP servers and subagents to the God Agent's capabilities.",
  };

  const godAgent = (message: string, over: Partial<ClawDraftRequest> = {}): ClawDraftRequest =>
    request({
      message,
      catalog,
      canvas: {
        ...request().canvas,
        name: "God Agent",
        instructions: TOOLS_PROMPT,
        capabilities: [{ hub: "builtin", id: "orchestrator", label: "Orchestrator" }],
      },
      ...over,
    });

  const ackText = (events: AgentDraftBody[]): string | undefined =>
    (events.find((e) => e.event === "ack") as { text: string } | undefined)?.text;
  // The judge finds nothing unless a test says otherwise.
  const quiet = (over: Partial<DraftDeps>): Rig => rig({ judge: async () => judged([]), ...over });
  const warnings = (events: AgentDraftBody[]): string[] =>
    events.flatMap((e) => (e.event === "warning" ? [e.message] : []));

  it("adds every MCP and subagent without the judge, even when the judge is down", async () => {
    const r = quiet({
      classify: async () => ({ ...EDIT, capabilityAddAll: ["mcp", "subagent"] }),
      judge: async () => {
        throw new AuthoringLlmError("parse", "cut off");
      },
    });
    await run(godAgent("all mcps too and subagents too"), r);
    const caps = r.events.find((e) => e.event === "capabilities") as { bound: DraftPick[]; suggested: DraftPick[] };
    expect(caps.bound.map((p) => p.id)).toEqual(["xyne-spaces", "jira", "spaces", "github"]);
    expect(caps.bound.filter((p) => p.hub === "mcp").every((p) => p.access === "read")).toBe(true);
    expect(caps.suggested).toMatchObject([{ id: "figma", requiresConnection: "Figma" }]);
    expect(warnings(r.events)).toEqual([]);
    expect(ackText(r.events)).toBe(
      "Added Xyne Spaces, Jira, spaces and github. Figma isn't connected yet, so it's a suggestion on the canvas.",
    );
  });

  it("lets the catalog decide for a kind the user wants all of, keeping write access they asked for", async () => {
    const r = quiet({
      classify: async () => ({ ...EDIT, capabilityAddAll: ["mcp"] }),
      judge: async () =>
        judged([
          { ...pick("mcp", "figma", "Figma"), requiresConnection: "Figma" },
          { ...pick("mcp", "xyne-spaces", "Xyne Spaces"), access: "write" },
        ]),
    });
    await run(godAgent("add all mcps and let it send DMs"), r);
    const caps = r.events.find((e) => e.event === "capabilities") as { bound: DraftPick[]; suggested: DraftPick[] };
    expect(caps.bound.map((p) => [p.id, p.access])).toEqual([["xyne-spaces", "write"], ["jira", "read"]]);
    expect(caps.suggested.map((p) => p.id)).toEqual(["figma"]);
  });

  it("brings the Tools section up to date on a tools-only edit, keeping the lines it had", async () => {
    const r = quiet({ classify: async () => ({ ...EDIT, capabilityAddAll: ["subagent"] }) });
    await run(godAgent("add all the subagents"), r);
    const done = r.events.find((e) => e.event === "instructions.done") as { text: string; repaired: boolean };
    expect(done.text).toContain("Tools\n- Orchestrator: coordinate the overall flow.\n- spaces: use it when the job needs it.\n- github:");
    expect(done.text.indexOf("github")).toBeLessThan(done.text.indexOf("Rules"));
    // Only the Tools section changes: the rest of the prompt is the user's.
    expect(done.text).toContain("How you work\n1. Read the request.");
    expect(done.repaired).toBe(false);
  });

  it("drops the Tools section when an edit removes the last tool", async () => {
    const r = quiet({
      classify: async () => ({ ...EDIT, ack: "", capabilityRemovals: [{ hub: "builtin", id: "orchestrator" }] }),
    });
    await run(godAgent("remove the orchestrator"), r);
    const done = r.events.find((e) => e.event === "instructions.done") as { text: string };
    expect(done.text).not.toContain("Tools");
    expect(done.text).toContain("1. Read the request.\n\nRules");
  });

  it("leaves the instructions alone when the user is editing them", async () => {
    const r = quiet({ classify: async () => ({ ...EDIT, capabilityAddAll: ["subagent"] }) });
    await run(godAgent("add all the subagents", { userOwned: ["instructions"] }), r);
    expect(names(r.events)).not.toContain("instructions.done");
  });

  it("never claims a named tool was added when the judge failed", async () => {
    const r = quiet({
      classify: async () => ({ ...EDIT, capabilityAdds: ["Jira"], ack: "Added Jira." }),
      judge: async () => {
        throw new AuthoringLlmError("timeout", "slow");
      },
    });
    await run(godAgent("add jira to it"), r);
    expect(names(r.events)).not.toContain("capabilities");
    expect(warnings(r.events)).toEqual(["Couldn't add Jira automatically. You can add it from the canvas."]);
    expect(names(r.events)).not.toContain("ack");
  });

  it("says when a named tool isn't in the catalog", async () => {
    const r = quiet({ classify: async () => ({ ...EDIT, capabilityAdds: ["Linear"] }), judge: async () => judged([]) });
    await run(godAgent("add linear please"), r);
    expect(ackText(r.events)).toBe("Couldn't find Linear among your tools.");
  });

  it("says when what was asked for is already on the canvas", async () => {
    const r = quiet({
      classify: async () => ({ ...EDIT, capabilityAdds: ["Orchestrator"] }),
      judge: async () => judged([pick("builtin", "orchestrator", "Orchestrator")]),
    });
    await run(godAgent("add the orchestrator"), r);
    expect(ackText(r.events)).toBe("Orchestrator is already on the canvas.");
  });

  it("gives tools named in earlier messages their own judge pass, without waiting for the first", async () => {
    const intents: string[] = [];
    const r = quiet({
      classify: async () => ({ ...DRAFT, name: "God Agent", capabilityAdds: ["Jira"] }),
      judge: async (input: JudgeInput) => {
        intents.push(input.intent);
        return input.intent.includes("Jira") ? judged([{ ...pick("mcp", "jira", "Jira"), confidence: 1 }]) : judged([]);
      },
    });
    await run(request({ message: "it should be the god agent", catalog }), r);
    expect(intents).toEqual(["it should be the god agent", "Add these to the agent, by name: Jira."]);
    const caps = r.events.find((e) => e.event === "capabilities") as { bound: DraftPick[] };
    expect(caps.bound.map((p) => p.id)).toEqual(["jira"]);
    expect(ackText(r.events)).toBe("Drafted God Agent. Added Jira.");
  });

  it("skips the extra pass when the first judge saw the name, and retries once if it failed", async () => {
    const intents: string[] = [];
    let calls = 0;
    const r = quiet({
      classify: async () => ({ ...EDIT, capabilityAdds: ["Jira"] }),
      judge: async (input: JudgeInput) => {
        intents.push(input.intent);
        if (++calls === 1) throw new AuthoringLlmError("timeout", "queued");
        return judged([{ ...pick("mcp", "jira", "Jira"), confidence: 1 }]);
      },
    });
    await run(godAgent("add jira to it"), r);
    expect(intents).toEqual(["add jira to it", "Add these to the agent, by name: Jira."]);
    expect(ackText(r.events)).toBe("Added Jira.");
    expect(warnings(r.events)).toEqual([]);
  });

  it("does not warn about tools on a turn that only talks", async () => {
    const r = quiet({
      classify: async () => ({ ...EDIT, mode: "chat", fields: [], reply: "Here's how.", ack: "" }),
      judge: async () => {
        throw new AuthoringLlmError("http", "boom");
      },
    });
    await run(godAgent("how does the orchestrator work?"), r);
    expect(warnings(r.events)).toEqual([]);
  });

  it("adds a heads-up when the agent ends up with too many tools", async () => {
    const big: ClawDraftRequest["catalog"] = {
      subagents: [],
      integrations: Array.from({ length: 4 }, (_, i) => ({
        slug: `mcp-${i}`,
        label: `Product ${i}`,
        kind: "mcp",
        readTools: Array.from({ length: 8 }, (_, t) => ({ name: `read_${t}`, description: "", riskLevel: "read" })),
        writeTools: [],
      })),
    };
    const r = quiet({ classify: async () => ({ ...EDIT, capabilityAddAll: ["mcp"] }) });
    await run(godAgent("add every mcp", { catalog: big }), r);
    expect(ackText(r.events)).toBe(
      "Added 4 MCP servers with read access. This agent now has about 32 tools. Over 25 makes it slower and more likely to pick the wrong one, so remove any it won't need.",
    );
  });
});

describe("tools helpers", () => {
  const many = (hub: DraftPick["hub"], n: number): DraftPick[] =>
    Array.from({ length: n }, (_, i) => ({ ...pick(hub, `${hub}-${i}`, `${hub} ${i}`), access: "read" as const }));

  it("lists each tool while the list is short", () => {
    expect(toolsSection([pick("mcp", "jira", "Jira")]).markdown).toBe("Tools\n- Jira: reads DMs.");
  });

  it("sums up a long list per kind, in plain text", () => {
    // Two catalog items can share a label ("Sandbox"); the line names it once.
    const twin = { ...many("mcp", 1)[0]!, id: "mcp-twin" };
    const { markdown } = toolsSection([...many("mcp", 6), twin, ...many("subagent", 4), pick("builtin", "orchestrator", "Orchestrator")]);
    expect(markdown).toBe(
      [
        "Tools",
        "- MCP servers, read only: mcp 0, mcp 1, mcp 2, mcp 3, mcp 4, mcp 5.",
        "- Orchestrator: reads DMs.",
        "- Subagents: subagent 0, subagent 1, subagent 2, subagent 3. Hand a task to the one that owns that product.",
      ].join("\n"),
    );
    expect(markdown).not.toMatch(/#|\*\*/);
  });

  it("reads the lines an earlier prompt wrote for each tool", () => {
    const lines = toolLinesIn("Intro.\n\nTools\n- Slack: post the digest.\n- Jira: file bugs.\n\nRules\n- Be kind.");
    expect([...lines.entries()]).toEqual([
      ["slack", "- Slack: post the digest."],
      ["jira", "- Jira: file bugs."],
    ]);
  });

  it("offers products that aren't connected instead of binding them", () => {
    const picks = catalogPicks(["mcp", "builtin"], {
      catalog: {
        subagents: [],
        integrations: [
          { slug: "a", label: "A", kind: "mcp", readTools: [{ name: "r", description: "", riskLevel: "read" }], writeTools: [] },
          { slug: "b", label: "B", kind: "gateway", requiresConnection: "B", readTools: [{ name: "r", description: "", riskLevel: "read" }], writeTools: [] },
          // No read tools: nothing to turn on, so it is left out.
          { slug: "d", label: "D", kind: "mcp", readTools: [], writeTools: [{ name: "w", description: "", riskLevel: "write" }] },
          { slug: "c", label: "C", kind: "custom", readTools: [], writeTools: [] },
        ],
      },
      skills: [],
      knowledge: [],
    });
    expect(picks.bound.map((p) => [p.hub, p.id, p.access])).toEqual([["mcp", "a", "read"], ["builtin", "c", undefined]]);
    expect(picks.suggested.map((p) => p.id)).toEqual(["b"]);
  });

  it("counts a long kind instead of naming every item", () => {
    expect(capabilityAck({ bound: [...many("mcp", 6), ...many("subagent", 2)], suggested: [] })).toBe(
      "Added 6 MCP servers with read access, subagent 0 and subagent 1.",
    );
  });

  it("warns only when the agent crosses the line, or a whole kind is added past it", () => {
    const heavy: ClawDraftRequest["catalog"] = {
      subagents: [],
      integrations: [{ slug: "x", label: "X", kind: "mcp", readTools: Array.from({ length: 30 }, (_, t) => ({ name: `r${t}`, description: "", riskLevel: "read" })), writeTools: [] }],
    };
    const x = [pick("mcp", "x", "X")];
    const more = [...x, pick("subagent", "s", "s")];
    expect(crowdedNote([], x, heavy, false)).toMatch(/about 30 tools/);
    expect(crowdedNote(x, more, heavy, false)).toBe("");
    expect(crowdedNote(x, more, heavy, true)).toMatch(/about 31 tools/);
  });
});

describe("classify: add all", () => {
  it("keeps known kinds once, and only on drafts and edits", () => {
    const edit = normalizeDecision(
      { mode: "edit", fields: ["tools"], capabilityAddAll: ["mcp", "subagent", "mcp", "nonsense"] },
      request({ canvas: { ...request().canvas, name: "A", instructions: "x" } }),
    );
    expect(edit.capabilityAddAll).toEqual(["mcp", "subagent"]);
    expect(edit.fields).toEqual(["tools"]);
    const skillsOnly = normalizeDecision(
      { mode: "edit", fields: [], capabilityAddAll: ["skill"] },
      request({ canvas: { ...request().canvas, name: "A", instructions: "x" } }),
    );
    expect(skillsOnly.fields).toEqual(["skills"]);
    const chat = normalizeDecision({ mode: "chat", capabilityAddAll: ["mcp"] }, request());
    expect(chat.capabilityAddAll).toBeUndefined();
  });
});

describe("picker accuracy guards", () => {
  const tool = (name: string, riskLevel = "read") => ({ name, description: "", riskLevel });
  const catalog: JudgeInput["catalog"] = {
    subagents: [],
    integrations: [
      { slug: "xyne-spaces", label: "Xyne Spaces", kind: "mcp", description: "Internal Xyne Spaces platform integration", readTools: [], writeTools: [tool("send_message", "write")] },
      { slug: "xyne-spaces-app-tools", label: "Xyne Spaces App Tools", kind: "mcp", description: "Bot/app-credential write tools for Xyne Spaces", readTools: [tool("app_read")], writeTools: [] },
      { slug: "x-news", label: "X (AI accounts)", kind: "mcp", description: "Read public X/Twitter posts", readTools: [tool("search_tweets")], writeTools: [] },
      { slug: "google", label: "Google", kind: "mcp", description: "Google OAuth integration (Gmail, Calendar, Drive)", readTools: [tool("google-gmail-search")], writeTools: [] },
    ],
  };
  const base = { catalog, skills: [], knowledge: [], hubs: ["mcp"] as const };
  const pick = (id: string) => ({ id, confidence: 1, reason: "" });

  it("shows each product's description and never offers the always-available ones", () => {
    const prompt = buildJudgePrompt({ ...base, intent: "brief me" });
    expect(prompt).toContain("- x-news | X (AI accounts) — Read public X/Twitter posts");
    expect(prompt).not.toContain("xyne-spaces-app-tools");
  });

  it("drops a pick of a product it never offers", () => {
    const out = resolveJudgement({ mcp: [pick("xyne-spaces-app-tools")] }, { ...base, intent: "post in Spaces" });
    expect(out.bound).toEqual([]);
    expect(out.suggested).toEqual([]);
  });

  it("only suggests a social feed the job doesn't name (Xyne is not X)", () => {
    const out = resolveJudgement(
      { mcp: [pick("xyne-spaces"), pick("google"), pick("x-news")] },
      { ...base, intent: "Every weekday go through my Xyne Spaces DMs and mentions, and my Gmail" },
    );
    expect(out.bound.map((p) => p.id)).toEqual(["xyne-spaces", "google"]);
    expect(out.suggested.map((p) => p.id)).toContain("x-news");
  });

  it("binds a social feed the job names", () => {
    const out = resolveJudgement({ mcp: [pick("x-news")] }, { ...base, intent: "collect the top posts about AI from X every day" });
    expect(out.bound.map((p) => p.id)).toEqual(["x-news"]);
  });
});

describe("hollow drafts", () => {
  const input = request({ message: "Every weekday at 9am, go through my Spaces DMs and my Gmail and tell me who to reply to first." });
  const ack = "Drafted a daily inbox manager that scans your Spaces and Gmail.";

  it("spots a first draft with no name or description", () => {
    expect(isHollowDraft(normalizeDecision({ mode: "draft", ack }, input))).toBe(true);
    expect(isHollowDraft(normalizeDecision({ mode: "draft", name: "Inbox", ack }, input))).toBe(false);
  });

  it("fills the name, handle and description from what the model said it drafted", () => {
    const d = fillDraftIdentity(normalizeDecision({ mode: "draft", ack }, input), input);
    expect(d.name).toBe("Daily Inbox Manager");
    expect(d.handle).toBe("daily-inbox-manager");
    expect(d.description).toBe("Daily inbox manager that scans your Spaces and Gmail");
  });

  it("falls back to the user's words when there is no ack, and leaves a full draft alone", () => {
    const bare = request({ message: "Create a release copilot for the platform team" });
    expect(fillDraftIdentity(normalizeDecision({ mode: "draft", ack: "" }, bare), bare).name).toBe("Release Copilot");
    expect(nameFromMessage("Create a release copilot for the platform team")).toBe("Release Copilot");
    const full = normalizeDecision({ mode: "draft", name: "Priority Inbox", description: "Ranks replies.", ack }, input);
    expect(fillDraftIdentity(full, input)).toMatchObject({ name: "Priority Inbox", description: "Ranks replies." });
  });
});

describe("planner answers that put the fields inside \"fields\" as ops", () => {
  // Captured from the fast model under load (2026-10-01).
  const empty = request({ message: "Every weekday at 9am, go through my Xyne Spaces activity, DMs and mentions, and my Gmail, and tell me who to reply to first." });
  const filled = request({
    message: "rename it to Inbox Triage",
    canvas: {
      ...request().canvas,
      name: "Morning Brief",
      instructions: "You are the Morning Brief agent.",
      capabilities: [
        { hub: "mcp", id: "xyne-spaces", label: "Xyne Spaces" },
        { hub: "mcp", id: "google", label: "Google" },
      ],
    },
  });

  it("reads a first draft's name, handle, description, schedule, permission and adds", () => {
    const raw = {
      mode: "draft",
      reply: "I'll draft a daily inbox manager for you.",
      fields: [
        { op: "set", title: "Name", type: "text", value: "Daily Inbox Manager" },
        { op: "set", title: "Handle", type: "text", value: "daily-inbox-manager" },
        { op: "set", title: "Description", type: "text", value: "Summarizes your daily activity and DMs to prioritize replies." },
        { op: "set", title: "Schedule", type: "object", value: { kind: "repeat", cron: "0 9 * * 1-5", label: "Weekdays at 9:00 AM", task: "List who to reply to first." } },
        { op: "set", title: "Permission", type: "text", value: "read-only" },
        { op: "set", title: "Instructions", type: "text", value: "On weekdays at 9am, scan Spaces and Gmail." },
        { op: "set", title: "Capability Adds", type: "array", value: ["Xyne Spaces", "Gmail"] },
      ],
      ack: "Drafted a daily inbox manager.",
    };
    const d = normalizeDecision(raw, empty);
    expect(d).toMatchObject({
      mode: "draft",
      name: "Daily Inbox Manager",
      handle: "daily-inbox-manager",
      description: "Summarizes your daily activity and DMs to prioritize replies.",
      schedule: { kind: "repeat", cron: "0 9 * * 1-5" },
      permission: { mode: "read-only" },
      instructionsBrief: "On weekdays at 9am, scan Spaces and Gmail.",
      capabilityAdds: ["Xyne Spaces", "Gmail"],
    });
    expect(d.fields).toContain("schedule");
    expect(isHollowDraft(d)).toBe(false);
  });

  it("takes lowercase titles and an object permission", () => {
    const d = normalizeDecision(
      {
        mode: "draft",
        fields: [
          { op: "set", title: "name", value: "Daily Slack DM Summarizer" },
          { op: "set", title: "description", value: "Summarizes unread Slack DMs each morning at 8 AM." },
          { op: "set", title: "permission", type: "object", value: { mode: "ask-first" } },
          { op: "set", title: "capabilityAdds", value: ["Slack"] },
        ],
        ack: "Drafted a daily Slack DM summarizer.",
      },
      empty,
    );
    expect(d).toMatchObject({ name: "Daily Slack DM Summarizer", permission: { mode: "ask-first" }, capabilityAdds: ["Slack"] });
  });

  it("reads an edit's rename and a removal", () => {
    const rename = normalizeDecision(
      { mode: "edit", fields: [{ op: "set", title: "name", value: "Inbox Triage" }, { op: "set", title: "handle", value: "inbox-triage" }], ack: "Renamed it." },
      filled,
    );
    expect(rename).toMatchObject({ mode: "edit", name: "Inbox Triage", handle: "inbox-triage" });
    expect(rename.fields).toEqual(expect.arrayContaining(["name", "handle"]));

    const removal = normalizeDecision(
      { mode: "edit", fields: [{ op: "remove", hub: "mcp", id: "google" }], ack: "Removed Gmail." },
      { ...filled, message: "remove Gmail, I only want Spaces" },
    );
    expect(removal.capabilityRemovals).toEqual([{ hub: "mcp", id: "google" }]);
  });

  it("keeps a titled op that is not a canvas field as a custom property, and leaves the usual shape alone", () => {
    const out = unfoldFieldOps({ mode: "draft", fields: [{ op: "set", title: "Budget", type: "number", value: "500" }] });
    expect(out["properties"]).toEqual([{ op: "set", title: "Budget", type: "number", value: "500" }]);
    const usual = { mode: "edit", fields: ["name"], name: "X" };
    expect(unfoldFieldOps(usual)).toBe(usual);
  });
});
