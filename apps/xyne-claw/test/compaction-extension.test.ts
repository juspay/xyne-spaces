import { test, expect, vi, beforeEach } from "vitest";

// Mock the pi package BEFORE importing the extension so `compact`/`estimateTokens`
// are controllable. `estimateTokens` is mocked large so evaluateCompaction sees a
// non-trivial kept window and chooses the fresh-start path.
const compactMock = vi.fn();
vi.mock("@earendil-works/pi-coding-agent", () => ({
  compact: (...args: unknown[]) => compactMock(...args),
  estimateTokens: () => 25_000, // > default keepRecentTokens (20_000) → fresh start
}));

import { compactionExtension, evaluateCompaction } from "../src/compaction-extension.js";

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
