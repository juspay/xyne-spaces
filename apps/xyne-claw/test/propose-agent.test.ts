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
  systemPrompt:
    "You are a triage agent. Read each ticket, classify it, and route it to the right owner.",
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
    ["stub system prompt", { ...validDraft, systemPrompt: "be helpful" }, /systemPrompt/i],
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
