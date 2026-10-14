import { test, expect, vi, beforeEach } from "vitest";

// Mock the pi package BEFORE importing the extension so `compact`/`estimateTokens`
// are controllable. `estimateTokens` is mocked large so evaluateCompaction sees a
// non-trivial kept window and chooses the fresh-start path.
const compactMock = vi.fn();
vi.mock("@earendil-works/pi-coding-agent", () => ({
  compact: (...args: unknown[]) => compactMock(...args),
  estimateTokens: () => 25_000, // > default keepRecentTokens (20_000) → fresh start
}));

import { buildTaskAnchor, compactionExtension, evaluateCompaction, fitTask, summaryContent } from "../src/compaction-extension.js";
import { pinRunTask } from "../src/run-context.js";

/** Capture the `session_before_compact` handler the factory registers on `pi`. */
function registerHandler() {
  let handler:
    | ((event: unknown, ctx: unknown) => Promise<unknown> | unknown)
    | undefined;
  const pi = {
    on: (evt: string, fn: (event: unknown, ctx: unknown) => unknown) => {
      if (evt === "session_before_compact") handler = fn as typeof handler;
    },
  };
  compactionExtension(pi as unknown as Parameters<typeof compactionExtension>[0]);
  if (!handler) throw new Error("extension did not register session_before_compact");
  return handler;
}

/** A branch + preparation crafted so evaluateCompaction returns freshStart=true:
 *  no prior compaction → windowStart = branchEntries[0].id, and preparation
 *  keeps the whole window (firstKeptEntryId = that same id) with a big tail. */
function freshStartEvent() {
  const branchEntries = [
    { id: "e1", type: "message", message: { role: "user", content: [{ type: "text", text: "hello" }] } },
    { id: "e2", type: "message", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } },
  ];
  const preparation = {
    firstKeptEntryId: "e1", // == windowStart → pi kept the whole window
    messagesToSummarize: [],
    turnPrefixMessages: [],
    isSplitTurn: false,
    settings: { keepRecentTokens: 20_000, reserveTokens: 16_384 },
  };
  return { preparation, branchEntries, signal: undefined };
}

const ctx = {
  model: { id: "test-model", maxTokens: 8192 },
  modelRegistry: {
    getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-key", headers: {} }),
  },
};

beforeEach(() => {
  compactMock.mockReset();
});

test("sanity: the crafted event is on the fresh-start path", () => {
  const { preparation, branchEntries } = freshStartEvent();
  const r = evaluateCompaction(branchEntries as never, preparation as never);
  expect(r.freshStart).toBe(true);
});

test("EMPTY summary → does NOT commit compaction, falls back to pi-native (returns undefined) + emits fresh_start_empty", async () => {
  compactMock.mockResolvedValue({ summary: "", firstKeptEntryId: "__xyne_fresh_start__" });

  const handler = registerHandler();
  const result = await handler(freshStartEvent(), ctx);

  // The catastrophic case is now unreachable: no { compaction } is returned,
  // so pi-native runs and the window (messages) is preserved — NOT wiped.
  expect(result).toBeUndefined();
  expect(compactMock).toHaveBeenCalledTimes(1);
});

test("WHITESPACE-only summary is treated as empty → falls back", async () => {
  compactMock.mockResolvedValue({ summary: "   \n\t  ", firstKeptEntryId: "__xyne_fresh_start__" });

  const handler = registerHandler();
  const result = await handler(freshStartEvent(), ctx);

  // Whitespace is not a real summary → must be treated as empty (guard uses .trim()).
  expect(result).toBeUndefined();
});

test("NON-EMPTY summary → commits the fresh-start compaction ({ compaction })", async () => {
  const good = { summary: "A real summary of the conversation.", firstKeptEntryId: "__xyne_fresh_start__" };
  compactMock.mockResolvedValue(good);

  const handler = registerHandler();
  const result = await handler(freshStartEvent(), ctx);

  // A real summary is still committed, now with the resume anchor appended.
  const committed = (result as { compaction: { summary: string; firstKeptEntryId: string } }).compaction;
  expect(committed.firstKeptEntryId).toBe(good.firstKeptEntryId);
  expect(committed.summary.startsWith(good.summary)).toBe(true);
  expect(committed.summary).toContain("resuming after context compaction");
});

test("compact() throwing still degrades to pi-native (returns undefined, never throws)", async () => {
  compactMock.mockRejectedValue(new Error("Summarization failed: terminated"));

  const handler = registerHandler();
  await expect(handler(freshStartEvent(), ctx)).resolves.toBeUndefined();
});

test("summary that is only pi's appended file lists is treated as empty → falls back", async () => {
  compactMock.mockResolvedValue({
    summary:
      "\n\n<read-files>\n/app/session-skills/x/account-registry/SKILL.md\n/app/session-skills/x/observability/SKILL.md\n</read-files>",
    firstKeptEntryId: "__xyne_fresh_start__",
  });

  const handler = registerHandler();
  const result = await handler(freshStartEvent(), ctx);

  expect(result).toBeUndefined();
});

test("summaryContent strips read and modified file lists", () => {
  expect(summaryContent("<read-files>\na\n</read-files>\n\n<modified-files>\nb\n</modified-files>")).toBe("");
  expect(summaryContent("## Goal\nRCA the alarm\n\n<read-files>\na\n</read-files>")).toBe("## Goal\nRCA the alarm");
});

test("fresh-start summary carries the run's original task verbatim", async () => {
  compactMock.mockResolvedValue({ summary: "## Progress\nAlarm confirmed.", firstKeptEntryId: "__xyne_fresh_start__" });
  pinRunTask("Read the alert thread and perform a detailed RCA.");

  const handler = registerHandler();
  const result = await handler(freshStartEvent(), ctx);

  const committed = (result as { compaction: { summary: string } }).compaction;
  expect(committed.summary.startsWith("## Original Task (verbatim)\nRead the alert thread and perform a detailed RCA.")).toBe(true);
  expect(committed.summary).toContain("## Progress\nAlarm confirmed.");
});

test("buildTaskAnchor is empty without a task and keeps a typical long task whole", () => {
  expect(buildTaskAnchor("  ")).toBe("");
  const task = `${"rules ".repeat(1_200)}\nC. If the report can't be attached, post it as plain text.`;
  expect(buildTaskAnchor(task)).toContain(task.trim());
});

test("fitTask keeps the start and the end of an oversized task", () => {
  const task = `START ${"x".repeat(40_000)} END-OF-TASK output rules`;
  const fitted = fitTask(task);
  expect(fitted.length).toBeLessThan(24_100);
  expect(fitted.startsWith("START ")).toBe(true);
  expect(fitted.endsWith("END-OF-TASK output rules")).toBe(true);
  expect(fitted).toContain("characters of the task omitted");
});
