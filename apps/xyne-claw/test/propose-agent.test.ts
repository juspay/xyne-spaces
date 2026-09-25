import { test, expect, vi, describe } from "vitest";
import {
  buildProposeAgentTool,
  normalizeAgentSlug,
  type ProposeAgentRef,
  PROPOSE_AGENT_TOOL_NAME,
} from "../src/propose-agent.js";

async function callTool(ref: ProposeAgentRef, abortRun: (() => void) | undefined, params: unknown) {
  const tool = buildProposeAgentTool(ref, abortRun);
  expect(tool.name).toBe(PROPOSE_AGENT_TOOL_NAME);
  // Pi SDK tool shape: execute(toolCallId, params).
  return (
    tool as unknown as {
      execute: (
        id: string,
        p: unknown,
      ) => Promise<{ content: { text: string }[]; details?: Record<string, unknown> }>;
    }
  ).execute("tc-1", params);
}

const validDraft = {
  name: "Ticket Triage",
  description: "Triages incoming tickets",
  systemPrompt: `## Identity & tone
You are a triage agent. Be direct.

## Operational Workflow
1. Read each ticket.
2. Classify severity.
3. Route to the right owner.

## When to use each tool
Use spaces to notify. Use web-search only for public docs.

## Guardrails
Never delete tickets. Do not invent severity.

## Decision rules
IF severity is critical THEN page on-call.

## Error recovery
If search fails, continue with the ticket body.

## Contrastive examples
Anti-pattern: Hello! I'd be delighted to help…
Calibrated: Ticket #42 is P1 — routed to @oncall.
`,
  tools: ["spaces", "web-search"],
};

test("captures the draft into ref and fires abortRun to end the turn", async () => {
  const ref: ProposeAgentRef = {};
  const abortRun = vi.fn();
  const res = await callTool(ref, abortRun, validDraft);

  expect(abortRun).toHaveBeenCalledOnce();
  expect(ref.value).toMatchObject({
    variant: "draft",
    agent: {
      name: "Ticket Triage",
      slug: "ticket-triage",
      description: "Triages incoming tickets",
      tools: ["spaces", "web-search"],
    },
  });
  // The model must not be left thinking the agent exists.
  expect(res.content[0]!.text).toContain("STOP");
  expect(res.content[0]!.text).toMatch(/only if they approve/i);
});

test("derives a slug from the name and honours an explicit one", async () => {
  const derived: ProposeAgentRef = {};
  await callTool(derived, undefined, { ...validDraft, name: "Weekly  PR Report!" });
  expect(derived.value?.agent.slug).toBe("weekly-pr-report");

  const explicit: ProposeAgentRef = {};
  await callTool(explicit, undefined, { ...validDraft, slug: "My_Custom Slug" });
  expect(explicit.value?.agent.slug).toBe("my-custom-slug");
});

describe("rejections keep the turn alive so the model can retry", () => {
  test.each([
    ["missing name", { ...validDraft, name: "  " }, /name/i],
    ["missing description", { ...validDraft, description: "" }, /description/i],
    ["stub system prompt", { ...validDraft, systemPrompt: "be helpful" }, /systemPrompt|short/i],
    [
      "missing workflow",
      {
        ...validDraft,
        systemPrompt:
          "You are a triage agent that never deletes tickets and must not invent severity. Be direct and precise always.",
      },
      /Workflow/i,
    ],
  ])("%s", async (_label, params, pattern) => {
    const ref: ProposeAgentRef = {};
    const abortRun = vi.fn();
    const res = await callTool(ref, abortRun, params);

    expect(ref.value).toBeUndefined();
    // A rejected draft must NOT end the turn — the model has to be able to fix it.
    expect(abortRun).not.toHaveBeenCalled();
    expect(res.details?.["error"]).toBe(true);
    expect(res.content[0]!.text).toMatch(pattern);
  });
});

test("defaults permissionMode to ask-first", async () => {
  const ref: ProposeAgentRef = {};
  await callTool(ref, undefined, validDraft);
  expect(ref.value?.agent.permissionMode).toBe("ask-first");
});

test("accepts permissionMode and skillSlugs", async () => {
  const ref: ProposeAgentRef = {};
  await callTool(ref, undefined, {
    ...validDraft,
    permissionMode: "read-only",
    skillSlugs: ["ticket-triage-procedure"],
    deniedTools: ["jira.delete_issue"],
  });
  expect(ref.value?.agent.permissionMode).toBe("read-only");
  expect(ref.value?.agent.skillSlugs).toEqual(["ticket-triage-procedure"]);
  expect(ref.value?.agent.deniedTools).toEqual(["jira.delete_issue"]);
});

test("is idempotent — the first draft stands and repeats are no-ops", async () => {
  const ref: ProposeAgentRef = {};
  const abortRun = vi.fn();
  await callTool(ref, abortRun, validDraft);
  const second = await callTool(ref, abortRun, { ...validDraft, name: "Something Else" });

  expect(ref.value?.agent.name).toBe("Ticket Triage");
  expect(ref.duplicates).toBe(1);
  expect(second.details?.["duplicate"]).toBe(true);
});

test("carries the agent's own summary line, and omits it when absent", async () => {
  // The card can only show WHAT was drafted; the summary is where the agent says
  // why. claw-auth posts it beside the card and falls back when it's missing.
  const withSummary: ProposeAgentRef = {};
  await callTool(withSummary, undefined, {
    ...validDraft,
    summary: "Granted it GitHub and Spaces; left out anything that can write.",
  });
  expect(withSummary.value?.agent.summary).toBe(
    "Granted it GitHub and Spaces; left out anything that can write.",
  );

  const without: ProposeAgentRef = {};
  await callTool(without, undefined, { ...validDraft, summary: "   " });
  expect(without.value?.agent).not.toHaveProperty("summary");
});

test("normalizes the tool list without inventing or dropping identifiers", async () => {
  const ref: ProposeAgentRef = {};
  await callTool(ref, undefined, {
    ...validDraft,
    // Duplicates, padding and non-strings — but unknown slugs pass through
    // untouched: only claw-auth knows this org's catalog, and silently dropping
    // one here would hide it from the card's "not granted" note.
    tools: [" spaces ", "spaces", "", 42, "totally-made-up"],
  });
  expect(ref.value?.agent.tools).toEqual(["spaces", "totally-made-up"]);
});

test("survives a throwing abortRun rather than losing the draft", async () => {
  const ref: ProposeAgentRef = {};
  const abortRun = vi.fn(() => {
    throw new Error("abort wiring broken");
  });
  await expect(callTool(ref, abortRun, validDraft)).resolves.toBeDefined();
  expect(ref.value).toBeDefined();
});

test("normalizeAgentSlug matches the slug rule the server enforces", () => {
  expect(normalizeAgentSlug("  Ticket   Triage  ")).toBe("ticket-triage");
  expect(normalizeAgentSlug("--weird--")).toBe("weird");
  expect(normalizeAgentSlug("!!!")).toBe("");
  expect(normalizeAgentSlug("a".repeat(200)).length).toBe(80);
});

describe("detail-parity fields", () => {
  test("carries skills, knowledge, providerOrder, memory and scope through", async () => {
    const ref: ProposeAgentRef = {};
    await callTool(ref, undefined, {
      ...validDraft,
      skills: ["pr-review", "pr-review", "  "],
      knowledge: { scope: "COLLECTIONS", collections: ["Handbook", "Handbook"] },
      providerOrder: ["claude", "codex"],
      memory: { enabled: true, requiresApproval: false },
      scope: "global",
    });

    expect(ref.value).toMatchObject({
      variant: "draft",
      agent: {
        skills: ["pr-review"],
        knowledge: { scope: "COLLECTIONS", collections: ["Handbook"] },
        providerOrder: ["claude", "codex"],
        memory: { enabled: true, requiresApproval: false },
        scope: "global",
      },
    });
  });

  test("omits every new field when the model does not send them", async () => {
    const ref: ProposeAgentRef = {};
    await callTool(ref, undefined, validDraft);
    const agent = (ref.value as { agent: Record<string, unknown> }).agent;

    expect(agent.skills).toBeUndefined();
    expect(agent.knowledge).toBeUndefined();
    expect(agent.providerOrder).toBeUndefined();
    expect(agent.memory).toBeUndefined();
    expect(agent.scope).toBeUndefined();
  });

  test("drops junk values instead of passing them on", async () => {
    const ref: ProposeAgentRef = {};
    await callTool(ref, undefined, {
      ...validDraft,
      skills: "not-an-array",
      knowledge: { scope: "NONSENSE", collections: [1, 2] },
      memory: { enabled: "yes" },
      scope: "everyone",
    });
    const agent = (ref.value as { agent: Record<string, unknown> }).agent;

    expect(agent.skills).toBeUndefined();
    expect(agent.knowledge).toBeUndefined();
    expect(agent.memory).toBeUndefined();
    expect(agent.scope).toBeUndefined();
  });
});
