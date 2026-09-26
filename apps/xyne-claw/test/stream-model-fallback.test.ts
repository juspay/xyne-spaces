import { describe, expect, it, vi } from "vitest";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { installStreamModelFallback } from "../src/stream-model-fallback.js";

const model = (id: string): Model<Api> =>
  ({ id, name: id, provider: "litellm", api: "openai-completions" }) as unknown as Model<Api>;

const FAST = model("glm-5.3-flash");
const SLOW = model("private-large-spaces");
const context = { messages: [] } as unknown as Context;

function message(m: Model<Api>, stopReason: AssistantMessage["stopReason"], text = "", errorMessage?: string): AssistantMessage {
  return {
    role: "assistant",
    content: text ? [{ type: "text", text }] : [],
    api: m.api,
    provider: m.provider,
    model: m.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: 0,
  };
}

function streamOf(events: AssistantMessageEvent[]): AssistantMessageEventStream {
  const s = createAssistantMessageEventStream();
  queueMicrotask(() => {
    for (const e of events) s.push(e);
    s.end();
  });
  return s;
}

const ok = (m: Model<Api>, text: string): AssistantMessageEvent[] => {
  const partial = message(m, "stop", text);
  return [
    { type: "start", partial },
    { type: "text_start", contentIndex: 0, partial },
    { type: "text_delta", contentIndex: 0, delta: text, partial },
    { type: "done", reason: "stop", message: partial },
  ];
};

const failBeforeOutput = (m: Model<Api>, reason: "error" | "aborted" = "error"): AssistantMessageEvent[] => [
  { type: "start", partial: message(m, "stop") },
  { type: "error", reason, error: message(m, reason, "", "no healthy deployments") },
];

async function collect(stream: AssistantMessageEventStream | Promise<AssistantMessageEventStream>) {
  const s = await stream;
  const events: AssistantMessageEvent[] = [];
  for await (const e of s) events.push(e);
  return { events, result: await s.result() };
}

function setup(behaviour: (m: Model<Api>, call: number) => AssistantMessageEvent[] | Error) {
  const calls: string[] = [];
  const agent = {
    streamFn: (m: Model<Api>, _c: Context, _o?: SimpleStreamOptions) => {
      calls.push(m.id);
      const b = behaviour(m, calls.length);
      if (b instanceof Error) throw b;
      return streamOf(b);
    },
  };
  const onFallback = vi.fn();
  installStreamModelFallback(agent, FAST, SLOW, { label: "test", onFallback });
  return { agent, calls, onFallback };
}

describe("installStreamModelFallback", () => {
  it("passes the fast model's stream through untouched when it succeeds", async () => {
    const { agent, calls, onFallback } = setup((m) => ok(m, "fast answer"));
    const { events, result } = await collect(agent.streamFn(FAST, context));
    expect(calls).toEqual(["glm-5.3-flash"]);
    expect(events.map((e) => e.type)).toEqual(["start", "text_start", "text_delta", "done"]);
    expect(result.model).toBe("glm-5.3-flash");
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("retries on the fallback model when the fast model errors before any output", async () => {
    const { agent, calls, onFallback } = setup((m) => (m.id === FAST.id ? failBeforeOutput(m) : ok(m, "kimi answer")));
    const { events, result } = await collect(agent.streamFn(FAST, context));
    expect(calls).toEqual(["glm-5.3-flash", "private-large-spaces"]);
    expect(events.filter((e) => e.type === "start")).toHaveLength(1);
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(result.model).toBe("private-large-spaces");
    expect(onFallback).toHaveBeenCalledWith("no healthy deployments");
  });

  it("retries on the fallback model when the fast model call throws", async () => {
    const { agent, calls } = setup((m) => (m.id === FAST.id ? new Error("ECONNREFUSED") : ok(m, "kimi answer")));
    const { result } = await collect(agent.streamFn(FAST, context));
    expect(calls).toEqual(["glm-5.3-flash", "private-large-spaces"]);
    expect(result.stopReason).toBe("stop");
  });

  it("stays on the fallback model for the rest of the session after one failure", async () => {
    const { agent, calls } = setup((m, call) => (m.id === FAST.id && call === 1 ? failBeforeOutput(m) : ok(m, "x")));
    await collect(agent.streamFn(FAST, context));
    await collect(agent.streamFn(FAST, context));
    expect(calls).toEqual(["glm-5.3-flash", "private-large-spaces", "private-large-spaces"]);
  });

  it("does not fall back once the fast model has started producing output", async () => {
    const { agent, calls, onFallback } = setup((m) => {
      const partial = message(m, "error", "half", "stream cut");
      return [
        { type: "start", partial },
        { type: "text_delta", contentIndex: 0, delta: "half", partial },
        { type: "error", reason: "error", error: partial },
      ];
    });
    const { result } = await collect(agent.streamFn(FAST, context));
    expect(calls).toEqual(["glm-5.3-flash"]);
    expect(result.stopReason).toBe("error");
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("does not fall back on a user abort", async () => {
    const { agent, calls } = setup((m) => failBeforeOutput(m, "aborted"));
    const { result } = await collect(agent.streamFn(FAST, context));
    expect(calls).toEqual(["glm-5.3-flash"]);
    expect(result.stopReason).toBe("aborted");
  });

  it("resolves with an error result when the fallback model also fails", async () => {
    const { agent, calls } = setup((m) => (m.id === FAST.id ? failBeforeOutput(m) : new Error("kimi down")));
    const { result } = await collect(agent.streamFn(FAST, context));
    expect(calls).toEqual(["glm-5.3-flash", "private-large-spaces"]);
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("kimi down");
  });

  it("leaves calls for other models alone", async () => {
    const { agent, calls } = setup((m) => ok(m, "x"));
    await collect(agent.streamFn(SLOW, context));
    expect(calls).toEqual(["private-large-spaces"]);
  });
});
