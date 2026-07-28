import { test, expect, vi, describe } from "vitest";
import {
  buildProposePlanTool,
  stripOrdinalPrefix,
  type ProposePlanRef,
  PROPOSE_PLAN_TOOL_NAME,
} from "../src/propose-plan.js";

async function callTool(
  ref: ProposePlanRef,
  abortRun: (() => void) | undefined,
  params: unknown,
) {
  const tool = buildProposePlanTool(ref, abortRun);
  expect(tool.name).toBe(PROPOSE_PLAN_TOOL_NAME);
  // Pi SDK tool shape: execute(toolCallId, params).
  return (tool as unknown as {
    execute: (id: string, p: unknown) => Promise<{ content: { text: string }[]; details?: Record<string, unknown> }>;
  }).execute("tc-1", params);
}

test("captures the plan into ref and fires abortRun to end the turn", async () => {
  const ref: ProposePlanRef = {};
  const abortRun = vi.fn();
  const res = await callTool(ref, abortRun, {
    title: "Ship it",
    desc: "the plan",
    todos: [
      { id: "t1", title: "Investigate" },
      { id: "t2", title: "Implement" },
    ],
    trivial: false,
  });

  expect(abortRun).toHaveBeenCalledOnce();
  expect(ref.value).toMatchObject({
    title: "Ship it",
    desc: "the plan",
    todos: [
      { id: "t1", title: "Investigate" },
      { id: "t2", title: "Implement" },
    ],
    trivial: false,
  });
  // A document is always present — synthesized from the todos when omitted.
  expect(typeof ref.value?.document).toBe("string");
  expect(ref.value?.document).toContain("Investigate");
  expect(res.content[0]!.text).toMatch(/STOP/);
});

test("carries the detailed document verbatim when the model provides one", async () => {
  const ref: ProposePlanRef = {};
  const doc = "# My Plan\n\nDetailed rationale here.\n\n## Steps\n\n1. First\n2. Second";
  await callTool(ref, vi.fn(), {
    title: "Ship it",
    todos: [{ id: "t1", title: "First" }],
    document: doc,
  });
  expect(ref.value?.document).toBe(doc);
});

test("synthesizes a document from the todos when the model omits it", async () => {
  const ref: ProposePlanRef = {};
  await callTool(ref, vi.fn(), {
    title: "Coffee run",
    desc: "grab coffees",
    todos: [
      { id: "t1", title: "Collect orders" },
      { id: "t2", title: "Place the order" },
    ],
  });
  const doc = ref.value?.document ?? "";
  expect(doc).toContain("# Coffee run");
  expect(doc).toContain("Collect orders");
  expect(doc).toContain("Place the order");
});

test("strips ordinal prefixes from todo titles so they render crisp", async () => {
  const ref: ProposePlanRef = {};
  await callTool(ref, vi.fn(), {
    title: "Migrate",
    todos: [
      { id: "t1", title: "Step 1 - Audit the callers" },
      { id: "t2", title: "2) Write the shim" },
      { id: "t3", title: "Plan the rollout" }, // NOT an ordinal prefix — kept intact
    ],
  });
  expect(ref.value?.todos.map((t) => t.title)).toEqual([
    "Audit the callers",
    "Write the shim",
    "Plan the rollout",
  ]);
});

describe("stripOrdinalPrefix", () => {
  test("strips word+number ordinal prefixes (any separator)", () => {
    expect(stripOrdinalPrefix("Step 1 - Audit")).toBe("Audit");
    expect(stripOrdinalPrefix("step2: build")).toBe("build");
    expect(stripOrdinalPrefix("Stage 3. deploy")).toBe("deploy");
    expect(stripOrdinalPrefix("Phase1) verify")).toBe("verify");
    expect(stripOrdinalPrefix("Task 4 — ship")).toBe("ship");
    expect(stripOrdinalPrefix("Plan1 - rollout")).toBe("rollout");
  });
  test("strips bare numeric prefixes only with a trailing separator", () => {
    expect(stripOrdinalPrefix("1. First")).toBe("First");
    expect(stripOrdinalPrefix("2) Second")).toBe("Second");
    expect(stripOrdinalPrefix("3 files to update")).toBe("3 files to update"); // no separator → kept
  });
  test("leaves real titles that merely start with an ordinal word", () => {
    expect(stripOrdinalPrefix("Plan the rollout")).toBe("Plan the rollout");
    expect(stripOrdinalPrefix("Task tracker cleanup")).toBe("Task tracker cleanup");
    expect(stripOrdinalPrefix("Stage the release")).toBe("Stage the release");
  });
  test("falls back to the original when stripping would empty it", () => {
    expect(stripOrdinalPrefix("Step 1")).toBe("Step 1");
    expect(stripOrdinalPrefix("  ")).toBe("");
  });
});

test("trivial:true is captured (skips the approval gate downstream)", async () => {
  const ref: ProposePlanRef = {};
  await callTool(ref, undefined, { title: "quick", todos: [{ id: "t1", title: "do" }], trivial: true });
  expect(ref.value?.trivial).toBe(true);
});

test("is idempotent — the first plan stands, later calls are no-ops", async () => {
  const ref: ProposePlanRef = {};
  const abortRun = vi.fn();
  await callTool(ref, abortRun, { title: "first", todos: [{ id: "t1", title: "a" }] });
  const second = await callTool(ref, abortRun, { title: "second", todos: [{ id: "t9", title: "z" }] });

  expect(ref.value?.title).toBe("first");
  expect(ref.duplicates).toBe(1);
  expect(second.details).toMatchObject({ duplicate: true });
  // abortRun fired only for the accepted (first) call.
  expect(abortRun).toHaveBeenCalledOnce();
});

test("rejects a plan with no valid todos (does NOT abort or set ref)", async () => {
  const ref: ProposePlanRef = {};
  const abortRun = vi.fn();
  const res = await callTool(ref, abortRun, { title: "x", todos: [{ id: "t1", title: "" }] });
  expect(ref.value).toBeUndefined();
  expect(ref.rejections).toBe(1);
  expect(abortRun).not.toHaveBeenCalled();
  expect(res.details).toMatchObject({ error: true });
});

test("de-dupes todo ids so rows key unambiguously", async () => {
  const ref: ProposePlanRef = {};
  await callTool(ref, undefined, {
    title: "dupes",
    todos: [
      { id: "t1", title: "a" },
      { id: "t1", title: "b" },
    ],
  });
  const ids = ref.value!.todos.map((t) => t.id);
  expect(new Set(ids).size).toBe(ids.length);
});
