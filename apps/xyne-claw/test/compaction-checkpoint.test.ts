import { test, expect, vi, beforeEach } from "vitest";

const compactMock = vi.fn();
vi.mock("@earendil-works/pi-coding-agent", () => ({
  compact: (...args: unknown[]) => compactMock(...args),
  estimateTokens: () => 25_000,
}));

import {
  trimSummarizerPreamble,
  buildResumeAnchor,
  setCompactionSubmitTool,
  compactionExtension,
} from "../src/compaction-extension.js";
import { looksLikeCompactionCheckpoint } from "../src/agent.js";

const SUMMARY = [
  "## Goal",
  "Ship the fix.",
  "",
  "## Progress",
  "### Done",
  "- [x] Read the code",
  "",
  "## Next Steps",
  "- Write the patch",
].join("\n");

function registerHandler() {
  let handler: ((event: unknown, ctx: unknown) => Promise<unknown> | unknown) | undefined;
  const pi = {
    on: (evt: string, fn: (event: unknown, ctx: unknown) => unknown) => {
      if (evt === "session_before_compact") handler = fn as typeof handler;
    },
  };
  compactionExtension(pi as unknown as Parameters<typeof compactionExtension>[0]);
  if (!handler) throw new Error("extension did not register session_before_compact");
  return handler;
}

function freshStartEvent() {
  const branchEntries = [
    { id: "e1", type: "message", message: { role: "user", content: [{ type: "text", text: "hello" }] } },
    { id: "e2", type: "message", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } },
  ];
  const preparation = {
    firstKeptEntryId: "e1",
    messagesToSummarize: [],
    turnPrefixMessages: [],
    isSplitTurn: false,
    settings: { keepRecentTokens: 20_000 },
  };
  return { preparation, branchEntries, signal: undefined };
}

const ctx = {
  model: { id: "test-model", maxTokens: 8192 },
  modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "k", headers: {} }) },
};

beforeEach(() => {
  compactMock.mockReset();
  setCompactionSubmitTool(undefined);
});

test("trimSummarizerPreamble drops leaked summarizer reasoning before the first heading", () => {
  const leaked = `Need to read conversation and previous summary, produce merged structured summary.\n\n${SUMMARY}`;
  const r = trimSummarizerPreamble(leaked);
  expect(r.trimmed).toBeGreaterThan(0);
  expect(r.text).toBe(SUMMARY);
});

test("trimSummarizerPreamble is a no-op when the text already starts with a heading", () => {
  expect(trimSummarizerPreamble(SUMMARY)).toEqual({ text: SUMMARY, trimmed: 0 });
});

test("trimSummarizerPreamble is a no-op when there is no heading at all", () => {
  const prose = "Just some prose with no headings whatsoever.";
  expect(trimSummarizerPreamble(prose)).toEqual({ text: prose, trimmed: 0 });
});

test("trimSummarizerPreamble never returns an empty summary", () => {
  const trailing = "Reasoning first.\n\n## ";
  const r = trimSummarizerPreamble(trailing);
  expect(r.text).toBe(trailing);
  expect(r.trimmed).toBe(0);
});

test("buildResumeAnchor names the required submit tool when there is one", () => {
  expect(buildResumeAnchor()).toContain("deliver the final result the task requires.");
  expect(buildResumeAnchor("submit-result")).toContain("using the `submit-result` tool to submit.");
});

test("the committed fresh-start summary is trimmed and carries the resume anchor", async () => {
  setCompactionSubmitTool("submit-result");
  compactMock.mockResolvedValue({
    summary: `Need to read conversation and previous summary.\n\n${SUMMARY}`,
    firstKeptEntryId: "__xyne_fresh_start__",
  });

  const handler = registerHandler();
  const result = (await handler(freshStartEvent(), ctx)) as { compaction: { summary: string } };

  expect(result.compaction.summary.startsWith("## Goal")).toBe(true);
  expect(result.compaction.summary).not.toContain("Need to read conversation");
  expect(result.compaction.summary).toContain("You are resuming after context compaction.");
  expect(result.compaction.summary).toContain("using the `submit-result` tool to submit.");
});

test("looksLikeCompactionCheckpoint needs at least two checkpoint headings", () => {
  expect(looksLikeCompactionCheckpoint(SUMMARY)).toBe(true);
  expect(looksLikeCompactionCheckpoint("## Progress\nsome work")).toBe(false);
  expect(looksLikeCompactionCheckpoint("## Key Decisions\na\n\n## Critical Context\nb")).toBe(true);
});

test("looksLikeCompactionCheckpoint ignores ordinary answers and empty text", () => {
  expect(looksLikeCompactionCheckpoint("Here is the answer: 42.")).toBe(false);
  expect(looksLikeCompactionCheckpoint("")).toBe(false);
  expect(looksLikeCompactionCheckpoint(undefined)).toBe(false);
  expect(looksLikeCompactionCheckpoint("I discussed ## Progress inline mid-sentence")).toBe(false);
});
