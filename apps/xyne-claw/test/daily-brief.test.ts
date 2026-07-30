import { test, expect, vi } from "vitest";
import {
  buildEmitBriefTool,
  type EmitBriefRef,
  EMIT_BRIEF_TOOL_NAME,
} from "../src/daily-brief.js";

async function callTool(
  ref: EmitBriefRef,
  abortRun: (() => void) | undefined,
  params: unknown,
) {
  const tool = buildEmitBriefTool(ref, abortRun);
  expect(tool.name).toBe(EMIT_BRIEF_TOOL_NAME);
  return (tool as unknown as {
    execute: (id: string, p: unknown) => Promise<{ content: { text: string }[]; details?: Record<string, unknown> }>;
  }).execute("tc-1", params);
}

const fullBrief = () => ({
  generated_for: "Pradeesh S",
  date: "2026-07-29",
  what_needs_you: [
    "Your queue isn't waiting on you — it's waiting on reviewers. Ten tickets sit in PR Review, not one with an assignee [clf-abc#1].",
    "Only two items are genuinely yours today: Prajwal's HIGH-priority Ask AI v2 bug-fix, untouched since 3 June [clf-abc#2], and a canvas-comments ticket filed this morning [clf-abc#3].",
  ],
  overdue: ["Nothing formally overdue — the items below are aging rather than late."],
  waiting_on_others: [
    "**Five PRs, one bottleneck.** Every ticket you've pushed to review is stalled at the same place: no reviewer assigned [clf-abc#4].",
    "**XYNE-15285 · ask ai claw fixes** — in PR Review, no assignee [clf-abc#5]",
  ],
  assigned_to_you: [
    "**XYNE-15115 · Bug fixes for Ask AI v2** — HIGH priority, untouched since 3 June [clf-abc#2]. If you pick up one thing today, this is it.",
  ],
  todays_schedule: ["Clear — no meetings today [clf-abc#6]. A full uninterrupted day."],
});

test("captures the prose brief into ref and fires abortRun", async () => {
  const ref: EmitBriefRef = {};
  const abortRun = vi.fn();
  const res = await callTool(ref, abortRun, fullBrief());

  expect(abortRun).toHaveBeenCalledOnce();
  expect(ref.value?.generated_for).toBe("Pradeesh S");
  expect(ref.value?.what_needs_you).toHaveLength(2);
  expect(ref.value?.what_needs_you[0]).toContain("[clf-abc#1]"); // citation preserved verbatim
  expect(ref.value?.waiting_on_others[0]).toContain("**Five PRs, one bottleneck.**"); // markdown preserved
  expect(res.content[0]!.text).toMatch(/STOP/);
});

test("is idempotent — a second call is a no-op", async () => {
  const ref: EmitBriefRef = {};
  const abortRun = vi.fn();
  await callTool(ref, abortRun, fullBrief());
  const dup = await callTool(ref, abortRun, { ...fullBrief(), generated_for: "Someone Else" });

  expect(ref.value?.generated_for).toBe("Pradeesh S");
  expect(ref.duplicates).toBe(1);
  expect(dup.details).toMatchObject({ duplicate: true });
  expect(abortRun).toHaveBeenCalledOnce();
});

test("rejects an entirely empty brief without aborting", async () => {
  const ref: EmitBriefRef = {};
  const abortRun = vi.fn();
  const res = await callTool(ref, abortRun, {
    generated_for: "Pradeesh S",
    date: "2026-07-29",
    what_needs_you: [],
    overdue: [],
    waiting_on_others: [],
    assigned_to_you: [],
    todays_schedule: [],
  });

  expect(ref.value).toBeUndefined();
  expect(ref.rejections).toBe(1);
  expect(abortRun).not.toHaveBeenCalled();
  expect(res.details).toMatchObject({ error: true });
});

test("a single-line 'quiet day' brief is accepted", async () => {
  const ref: EmitBriefRef = {};
  const res = await callTool(ref, vi.fn(), {
    generated_for: "Pradeesh S",
    date: "2026-07-29",
    what_needs_you: ["A quiet day — nothing pressing and no meetings."],
    overdue: ["Nothing overdue."],
    waiting_on_others: [],
    assigned_to_you: [],
    todays_schedule: ["Clear — no meetings today."],
  });
  expect(ref.value?.what_needs_you[0]).toContain("quiet day");
  expect(res.content[0]!.text).toMatch(/STOP/);
});

test("drops non-string / empty entries and caps line count", async () => {
  const ref: EmitBriefRef = {};
  await callTool(ref, vi.fn(), {
    ...fullBrief(),
    what_needs_you: ["kept", "", "   ", 42, null, { x: 1 }, "also kept"],
  });
  expect(ref.value?.what_needs_you).toEqual(["kept", "also kept"]);
});
