import { test, expect } from "vitest";
import { extractFinalAnswerText } from "../src/agent.js";

/**
 * extractFinalAnswerText returns the last TWO non-empty assistant turns joined
 * in chronological order. Rationale (see agent.ts "Final-answer extraction"):
 * a trailing todo-write splits the final answer and a short wrap-up across two
 * adjacent assistant turns, and which one holds the real answer is
 * nondeterministic (Mode A: answer first, Mode B: answer last) — so the only
 * shape-independent rule is to keep both.
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
