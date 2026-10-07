import { describe, expect, it } from "vitest";
import type { ClawDraftRequest } from "xyne-claw-shared";
import { AuthoringLlmError, type AuthoringLlmOptions } from "../src/authoring/authoring-llm.js";
import { answerWithFallback, buildTalkMessages, type TalkStream } from "../src/authoring/talk.js";

const never = new AbortController().signal;

/** A fake model: per endpoint, the chunks it streams and whether it then fails or stalls. */
function fakeStream(plan: Record<"talk" | "suggest", { chunks?: string[]; fail?: boolean; stall?: boolean }>): {
  stream: TalkStream;
  calls: string[];
} {
  const calls: string[] = [];
  const stream: TalkStream = async function* (_messages, options: AuthoringLlmOptions) {
    const endpoint = options.endpoint ?? "suggest";
    calls.push(endpoint);
    const step = plan[endpoint];
    if (step.stall) {
      await new Promise<void>((_resolve, reject) =>
        options.signal?.addEventListener("abort", () => reject(new AuthoringLlmError("aborted", "cancelled")), { once: true }),
      );
    }
    for (const chunk of step.chunks ?? []) yield chunk;
    if (step.fail) throw new AuthoringLlmError("http", "boom");
  };
  return { stream, calls };
}

describe("answerWithFallback", () => {
  it("answers on the main model", async () => {
    const { stream, calls } = fakeStream({ talk: { chunks: ["Hello ", "there."] }, suggest: {} });
    const shown: string[] = [];
    const out = await answerWithFallback([], (t) => shown.push(t), never, 10_000, stream);
    expect(out).toEqual({ text: "Hello there.", cutOff: false });
    expect(shown).toEqual(["Hello ", "there."]);
    expect(calls).toEqual(["talk"]);
  });

  it("lets the fast model answer when the main one fails before its first word", async () => {
    const { stream, calls } = fakeStream({ talk: { fail: true }, suggest: { chunks: ["Fast answer."] } });
    const out = await answerWithFallback([], () => {}, never, 10_000, stream);
    expect(out).toEqual({ text: "Fast answer.", cutOff: false });
    expect(calls).toEqual(["talk", "suggest"]);
  });

  it("gives up on a silent main model after the first-word wait", async () => {
    const { stream, calls } = fakeStream({ talk: { stall: true }, suggest: { chunks: ["Quick."] } });
    const out = await answerWithFallback([], () => {}, never, 10_000, stream, 20);
    expect(out.text).toBe("Quick.");
    expect(calls).toEqual(["talk", "suggest"]);
  });

  it("keeps what was shown when the answer breaks off, and never restarts it", async () => {
    const { stream, calls } = fakeStream({ talk: { chunks: ["Half an "], fail: true }, suggest: { chunks: ["dup"] } });
    const shown: string[] = [];
    const out = await answerWithFallback([], (t) => shown.push(t), never, 10_000, stream);
    expect(out).toEqual({ text: "Half an ", cutOff: true });
    expect(shown).toEqual(["Half an "]);
    expect(calls).toEqual(["talk"]);
  });

  it("throws when neither model says anything", async () => {
    const { stream } = fakeStream({ talk: { fail: true }, suggest: { fail: true } });
    await expect(answerWithFallback([], () => {}, never, 10_000, stream)).rejects.toThrow("boom");
  });
});

describe("buildTalkMessages", () => {
  const input = {
    draftId: "d",
    turnId: "t",
    userId: "u",
    now: "2026-09-30T06:00:00.000Z",
    timezone: "Asia/Kolkata",
    message: "What's the weather in Bangalore?",
    history: Array.from({ length: 20 }, (_v, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      text: `turn ${i} ${"x".repeat(3_000)}`,
    })),
    userOwned: [],
    canvas: { name: "", handle: "", description: "", instructions: "", permissionMode: "ask-first", schedule: null, capabilities: [] },
    catalog: { integrations: [], subagents: [] },
    skillCandidates: [],
    knowledgeCandidates: [],
  } as unknown as ClawDraftRequest;

  it("keeps the last 12 turns, trimmed, and puts the web results before the question", () => {
    const messages = buildTalkMessages(input, {
      ok: true,
      text: "[1] Weather\nURL: https://w.example\nSunny",
      sources: [{ title: "Weather", url: "https://w.example" }],
    });
    expect(messages).toHaveLength(1 + 12 + 1);
    expect(messages[1]!.content.startsWith("turn 8 ")).toBe(true);
    expect(messages[1]!.content.length).toBe(2_000);
    const last = messages.at(-1)!.content;
    expect(last.indexOf("Web results (fetched just now)")).toBeLessThan(last.indexOf("Their message:"));
  });

  it("tells the model when search wasn't available", () => {
    const last = buildTalkMessages(input, { ok: false, reason: "timeout" }).at(-1)!.content;
    expect(last).toContain("Web search was not available");
    expect(buildTalkMessages(input, null).at(-1)!.content).not.toContain("Web");
  });
});
