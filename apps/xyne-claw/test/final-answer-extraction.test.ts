import { test, expect } from "vitest";
import { extractFinalAnswerText } from "../src/agent.js";

/**
 * extractFinalAnswerText returns non-empty assistant turns of the current turn,
 * joined in chronological order. By default it keeps ALL of them (ask-ai etc.),
 * so the stored answer matches the streamed transcript; passing `maxTurns` (2 for
 * thread/Slack replies) keeps only that many trailing turns for a clean reply.
 * Rationale (see agent.ts "Final-answer extraction"): a trailing todo-write
 * splits the answer across adjacent turns and which one holds it is
 * nondeterministic, so 2 is the smallest split-agnostic window.
 */

type Block = { type: string; text?: string; name?: string };
type Msg = { role: string; content: Block[] | string };

const text = (t: string): Block => ({ type: "text", text: t });
const toolCall = (name: string): Block => ({ type: "toolCall", name });
const assistant = (...content: Block[]): Msg => ({ role: "assistant", content });
const user = (t: string): Msg => ({ role: "user", content: [text(t)] });
const toolResult = (): Msg => ({ role: "toolResult", content: [] });

const sessionWith = (messages: Msg[]): unknown => ({ messages });

test("Mode A: [answer + todo-write] then short wrap-up keeps the answer", () => {
  const answer = "The Q3 report shows revenue grew 14% [clf-abc#1].";
  const session = sessionWith([
    user("summarize the report"),
    assistant(text(answer), toolCall("todo-write")),
    toolResult(),
    assistant(text("Done — plan updated, everything cited.")),
  ]);
  expect(extractFinalAnswerText(session)).toBe(
    `${answer}\n\nDone — plan updated, everything cited.`,
  );
});

test("Mode B: ['let me synthesize' + todo-write] then answer keeps the answer", () => {
  const answer = "Here are your priorities: 1) fix auth, 2) ship exports.";
  const session = sessionWith([
    user("what are my priorities"),
    assistant(text("I've got the data. Let me update the plan and synthesize."), toolCall("todo-write")),
    toolResult(),
    assistant(text(answer)),
  ]);
  expect(extractFinalAnswerText(session)).toBe(
    `I've got the data. Let me update the plan and synthesize.\n\n${answer}`,
  );
});

test("single substantive turn returns just that turn", () => {
  const session = sessionWith([user("hi"), assistant(text("Hello! How can I help?"))]);
  expect(extractFinalAnswerText(session)).toBe("Hello! How can I help?");
});

test("empty assistant turns (bare tool calls) don't consume a slot", () => {
  const answer = "All 3 tickets are resolved [clf-xyz#0].";
  const session = sessionWith([
    user("check my tickets"),
    assistant(text(answer), toolCall("todo-write")),
    toolResult(),
    assistant(toolCall("verification-tool")), // no text — must be skipped
    toolResult(),
    assistant(text("Verified and done.")),
  ]);
  expect(extractFinalAnswerText(session)).toBe(`${answer}\n\nVerified and done.`);
});

test("keeps ALL non-empty assistant turns of the current turn (3+), in order", () => {
  // Multi-step turn: narration → tool → narration → tool → answer → wrap-up.
  // The old last-2 rule dropped the early narration; we now keep every turn so
  // the stored answer matches the streamed transcript (no completion repaint).
  const session = sessionWith([
    user("summarize the incident"),
    assistant(text("Let me search the logs."), toolCall("search")),
    toolResult(),
    assistant(text("Found 3 matching entries — analyzing."), toolCall("read")),
    toolResult(),
    assistant(text("Root cause: a config typo [clf-log#2].")),
    assistant(text("Done — all cited.")),
  ]);
  expect(extractFinalAnswerText(session)).toBe(
    "Let me search the logs.\n\n" +
      "Found 3 matching entries — analyzing.\n\n" +
      "Root cause: a config typo [clf-log#2].\n\n" +
      "Done — all cited.",
  );
});

test("maxTurns=2 (thread reply) keeps only the last two non-empty assistant turns", () => {
  // Same 3+-turn session as above, but a thread invocation caps at 2 so the
  // posted reply stays a clean answer + wrap-up (drops the early narration).
  const session = sessionWith([
    user("summarize the incident"),
    assistant(text("Let me search the logs."), toolCall("search")),
    toolResult(),
    assistant(text("Found 3 matching entries — analyzing."), toolCall("read")),
    toolResult(),
    assistant(text("Root cause: a config typo [clf-log#2].")),
    assistant(text("Done — all cited.")),
  ]);
  expect(extractFinalAnswerText(session, 2)).toBe(
    "Root cause: a config typo [clf-log#2].\n\nDone — all cited.",
  );
  // Empty turns still don't consume a slot under the cap.
  const withEmpty = sessionWith([
    user("check my tickets"),
    assistant(text("Searching…"), toolCall("search")),
    toolResult(),
    assistant(text("All 3 tickets are resolved [clf-xyz#0]."), toolCall("todo-write")),
    toolResult(),
    assistant(toolCall("verify")), // empty — skipped
    toolResult(),
    assistant(text("Verified and done.")),
  ]);
  expect(extractFinalAnswerText(withEmpty, 2)).toBe(
    "All 3 tickets are resolved [clf-xyz#0].\n\nVerified and done.",
  );
});

test("never crosses the current turn's user message into a previous exchange", () => {
  const session = sessionWith([
    user("first question"),
    assistant(text("Answer to the FIRST question — must not leak.")),
    user("second question"),
    assistant(text("Answer to the second question.")),
  ]);
  expect(extractFinalAnswerText(session)).toBe("Answer to the second question.");
});

test("falls back to getLastAssistantText when messages are unavailable", () => {
  const session = { getLastAssistantText: (): string => "fallback text" };
  expect(extractFinalAnswerText(session)).toBe("fallback text");
  expect(extractFinalAnswerText({})).toBeUndefined();
});
