import { beforeEach, describe, expect, it, vi } from "vitest";
import { xor, xorConfig, xorEnabled, XOR_TIMEOUT_MS, type XorQuestion } from "../src/xor.js";
import {
  beginJudgeRun,
  collectJudgeExchanges,
  judgeRunSummary,
  recordJudgeOutcome,
  setJudgeDebugSink,
} from "../src/judge-trace.js";
import { parseLlmJudgeReply } from "../src/judge-llm.js";
import { isolateEnv } from "./helpers/env.js";

const QUESTIONS: Record<string, XorQuestion> = {
  a: { type: "noul", instructions: "is it done?" },
  b: { type: "noul", instructions: "is it partial?" },
};

const ENV_KEYS = [
  "XOR_URL", "XOR_API_KEY", "XOR_MODEL", "XOR_BACKEND",
  "OUR_JEV_URL", "OUR_JEV_API_KEY", "OUR_NORMAL_JEV_URL", "OUR_NORMAL_JEV_API_KEY", "OUR_NORMAL_JEV_MODEL",
  "JUDGE_LLM_URL", "JUDGE_LLM_API_KEY", "JUDGE_LLM_MODEL", "JUDGE_LLM_TIMEOUT_MS", "JUDGE_BACKEND",
  "LITELLM_URL", "LITELLM_API_KEY", "LITELLM_AUTOMATION_API_KEY", "LITELLM_MODEL", "LITELLM_FAST_MODEL",
];

function systemOneReply(values: Record<string, number>): Response {
  const answers = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { type: "noul", noul: v }]));
  return new Response(JSON.stringify({ answers }), { status: 200 });
}

function chatReply(values: Record<string, number>): Response {
  const answers = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { noul: v }]));
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answers }) } }] }),
    { status: 200 },
  );
}

isolateEnv(ENV_KEYS, { clear: true });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

function enable(): void {
  process.env["OUR_NORMAL_JEV_URL"] = "https://ourjev.internal/v1/systemone";
  process.env["OUR_JEV_API_KEY"] = "k-ours";
}

describe("xorConfig", () => {
  it("is disabled with nothing configured", () => {
    expect(xorConfig()).toMatchObject({ backend: "xor", url: "", key: "", model: "jev-latest" });
    expect(xorEnabled()).toBe(false);
  });

  it("prefers XOR_* over the legacy names", () => {
    process.env["XOR_URL"] = "https://xor.internal/v1/systemone";
    process.env["XOR_API_KEY"] = "k-xor";
    process.env["XOR_MODEL"] = "xor-ft-v3";
    process.env["OUR_NORMAL_JEV_URL"] = "https://normal.internal/v1/systemone";
    process.env["OUR_NORMAL_JEV_API_KEY"] = "k-normal";
    process.env["OUR_NORMAL_JEV_MODEL"] = "normal-model";
    process.env["OUR_JEV_URL"] = "https://ourjev.internal/v1/systemone";
    process.env["OUR_JEV_API_KEY"] = "k-ours";
    process.env["LITELLM_URL"] = "https://litellm.internal";
    process.env["LITELLM_API_KEY"] = "k-lite";
    expect(xorConfig()).toEqual({
      backend: "xor",
      url: "https://xor.internal/v1/systemone",
      key: "k-xor",
      model: "xor-ft-v3",
      timeoutMs: XOR_TIMEOUT_MS,
    });
    expect(xorEnabled()).toBe(true);
  });

  it("falls back to OUR_NORMAL_JEV_* then OUR_JEV_*", () => {
    process.env["OUR_JEV_URL"] = "https://ourjev.internal/v1/systemone";
    process.env["OUR_JEV_API_KEY"] = "k-ours";
    expect(xorConfig()).toMatchObject({ url: "https://ourjev.internal/v1/systemone", key: "k-ours", model: "jev-latest" });

    process.env["OUR_NORMAL_JEV_URL"] = "https://normal.internal/v1/systemone";
    process.env["OUR_NORMAL_JEV_API_KEY"] = "k-normal";
    process.env["OUR_NORMAL_JEV_MODEL"] = "normal-model";
    expect(xorConfig()).toMatchObject({ url: "https://normal.internal/v1/systemone", key: "k-normal", model: "normal-model" });
  });

  it("serves xor through LiteLLM when no own URL/key is set", () => {
    process.env["LITELLM_URL"] = "https://litellm.internal/v1/";
    process.env["LITELLM_API_KEY"] = "k-lite";
    expect(xorConfig()).toMatchObject({ url: "https://litellm.internal/v1/systemone", key: "k-lite", model: "jev-latest" });
    expect(xorEnabled()).toBe(true);
  });

  it("switches to the LLM judge in llm mode, never exceeding the xor timeout", () => {
    process.env["XOR_BACKEND"] = "llm";
    process.env["JUDGE_LLM_URL"] = "https://llm.internal/v1/chat/completions";
    process.env["JUDGE_LLM_API_KEY"] = "k-llm";
    process.env["JUDGE_LLM_MODEL"] = "judge-model";
    process.env["JUDGE_LLM_TIMEOUT_MS"] = "60000";
    expect(xorConfig()).toEqual({
      backend: "llm",
      url: "https://llm.internal/v1/chat/completions",
      key: "k-llm",
      model: "judge-model",
      timeoutMs: XOR_TIMEOUT_MS,
    });
    delete process.env["XOR_BACKEND"];
    process.env["JUDGE_BACKEND"] = "LLM";
    expect(xorConfig().backend).toBe("llm");
  });
});

describe("xor", () => {
  it("POSTs state, model and questions with the bearer key", async () => {
    process.env["XOR_URL"] = "https://xor.internal/v1/systemone";
    process.env["XOR_API_KEY"] = "k-xor";
    process.env["XOR_MODEL"] = "xor-ft-v3";
    fetchMock.mockResolvedValueOnce(systemOneReply({ a: 0.8, b: 0.2 }));
    const answers = await xor({ state: "state", questions: QUESTIONS, purpose: "t" });
    expect(answers?.["a"]?.noul).toBe(0.8);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://xor.internal/v1/systemone");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer k-xor", "Content-Type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ state: "state", model: "xor-ft-v3", questions: QUESTIONS });
  });

  it("asks the LLM judge in llm mode", async () => {
    process.env["XOR_BACKEND"] = "llm";
    process.env["JUDGE_LLM_URL"] = "https://llm.internal/v1/chat/completions";
    process.env["JUDGE_LLM_API_KEY"] = "k-llm";
    process.env["JUDGE_LLM_MODEL"] = "judge-model";
    fetchMock.mockResolvedValueOnce(chatReply({ a: 0.9, b: 0.1 }));
    beginJudgeRun();
    const answers = await xor({ state: "state", questions: QUESTIONS, purpose: "t" });
    expect(answers?.["a"]?.noul).toBe(0.9);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://llm.internal/v1/chat/completions");
    expect(judgeRunSummary()?.backend).toBe("llm");
  });

  it("is unavailable when unconfigured, so callers keep their old path", async () => {
    expect(await xor({ state: "state", questions: QUESTIONS, purpose: "t" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips empty state or no questions", async () => {
    enable();
    expect(await xor({ state: "  ", questions: QUESTIONS, purpose: "t" })).toBeNull();
    expect(await xor({ state: "state", questions: {}, purpose: "t" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null on failure and records the exchange with its reason", async () => {
    enable();
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    const { result, exchanges } = await collectJudgeExchanges(() =>
      xor({ state: "state", questions: QUESTIONS, purpose: "sift" }),
    );
    expect(result).toBeNull();
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]).toMatchObject({ backend: "xor", purpose: "sift", ok: false, answers: null, questions: 2 });
    expect(exchanges[0]?.error).toBe("error: xor 500");
  });

  it("records per-run call stats including failures", async () => {
    enable();
    beginJudgeRun();
    fetchMock.mockResolvedValueOnce(systemOneReply({ a: 1, b: 0 }));
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    await xor({ state: "state", questions: QUESTIONS, purpose: "sift" });
    await xor({ state: "state", questions: QUESTIONS, purpose: "sift" });
    const summary = judgeRunSummary();
    expect(summary).toMatchObject({ backend: "xor", calls: 2, failed: 1, questions: 4 });
    expect(summary?.byPurpose["sift"]).toMatchObject({ calls: 2, failed: 1 });
    expect(summary).not.toHaveProperty("shadows");
  });
});

describe("judge debug events", () => {
  beforeEach(enable);

  it("sends every call and outcome to the run's debug sink", async () => {
    beginJudgeRun();
    const events: Array<{ kind: string; data: Record<string, unknown> }> = [];
    setJudgeDebugSink((kind, data) => events.push({ kind, data }));
    fetchMock.mockResolvedValueOnce(systemOneReply({ a: 1, b: 0 }));
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));

    await xor({ state: "state", questions: QUESTIONS, purpose: "tool-search" });
    await xor({ state: "state", questions: QUESTIONS, purpose: "tool-search" });
    recordJudgeOutcome("tool-search", "added 1", { added: [{ name: "spaces-desk-metrics", score: 0.9 }] });

    expect(events.map((e) => e.kind)).toEqual(["judge_call", "judge_call", "judge_outcome"]);
    expect(events[0]?.data).toMatchObject({ backend: "xor", purpose: "tool-search", questions: 2, ok: true });
    expect(events[1]?.data).toMatchObject({ ok: false, error: "error: xor 500" });
    expect(events[2]?.data).toMatchObject({ backend: "xor", purpose: "tool-search", summary: "added 1" });
    expect(JSON.parse(String(events[2]?.data["detail"]))).toEqual({ added: [{ name: "spaces-desk-metrics", score: 0.9 }] });
  });

  it("buffers events from before the sink is attached, then flushes them", async () => {
    beginJudgeRun();
    fetchMock.mockResolvedValueOnce(systemOneReply({ a: 1, b: 0 }));
    await xor({ state: "early state", questions: QUESTIONS, purpose: "pre-run" });
    recordJudgeOutcome("pre-run", "kept");

    const events: Array<{ kind: string; data: Record<string, unknown> }> = [];
    setJudgeDebugSink((kind, data) => events.push({ kind, data }));
    expect(events.map((e) => e.kind)).toEqual(["judge_call", "judge_outcome"]);
    expect(events[0]?.data).toMatchObject({ purpose: "pre-run", state: "early state", ok: true });

    fetchMock.mockResolvedValueOnce(systemOneReply({ a: 0, b: 1 }));
    await xor({ state: "state", questions: QUESTIONS, purpose: "later" });
    expect(events).toHaveLength(3);
  });

  it("never lets a throwing sink break the judge call", async () => {
    beginJudgeRun();
    setJudgeDebugSink(() => {
      throw new Error("recorder is gone");
    });
    fetchMock.mockResolvedValueOnce(systemOneReply({ a: 1, b: 0 }));
    const answers = await xor({ state: "state", questions: QUESTIONS, purpose: "tool-search" });
    expect(answers?.["a"]?.noul).toBe(1);
  });
});

describe("llm judge reply parsing", () => {
  it("accepts wrapped, bare and fenced answers and clamps to 0..1", () => {
    const raw = '```json\n{"answers":{"a":{"noul":1.4},"b":0.25}}\n```';
    expect(parseLlmJudgeReply(raw, QUESTIONS)).toEqual({
      a: { type: "noul", noul: 1 },
      b: { type: "noul", noul: 0.25 },
    });
  });

  it("drops a choice that is not one of the offered keys", () => {
    const questions: Record<string, XorQuestion> = {
      v: { type: "choice", instructions: "which?", criteria: { yes: "done", no: "not done" } },
    };
    expect(parseLlmJudgeReply('{"answers":{"v":{"choice":"maybe"}}}', questions)).toEqual({});
    expect(parseLlmJudgeReply('{"answers":{"v":"yes"}}', questions)).toEqual({ v: { type: "choice", choice: "yes" } });
  });

  it("throws on a reply with no JSON so the caller falls back", () => {
    expect(() => parseLlmJudgeReply("I cannot answer that", QUESTIONS)).toThrow();
  });
});

describe("xor images", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgo=";

  it("sends images alongside the state", async () => {
    enable();
    fetchMock.mockResolvedValue(systemOneReply({ a: 0.9, b: 0.1 }));
    const answers = await xor({ state: "screenshot", questions: QUESTIONS, purpose: "ui-tester", images: [PNG, PNG] });
    expect(answers?.["a"]?.noul).toBe(0.9);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.images).toEqual([PNG, PNG]);
    expect(body.state).toBe("screenshot");
  });

  it("omits the images field when there are none", async () => {
    enable();
    fetchMock.mockResolvedValue(systemOneReply({ a: 0.9, b: 0.1 }));
    await xor({ state: "s", questions: QUESTIONS, purpose: "p" });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).not.toHaveProperty("images");
  });

  it("refuses raw base64 or URLs without calling the backend", async () => {
    enable();
    expect(await xor({ state: "s", questions: QUESTIONS, purpose: "p", images: ["iVBORw0KGgo="] })).toBeNull();
    expect(await xor({ state: "s", questions: QUESTIONS, purpose: "p", images: ["https://x/y.png"] })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back when the llm backend is asked to read images", async () => {
    process.env["XOR_BACKEND"] = "llm";
    process.env["JUDGE_LLM_URL"] = "https://llm.internal/v1/chat/completions";
    process.env["JUDGE_LLM_API_KEY"] = "k-llm";
    process.env["JUDGE_LLM_MODEL"] = "small";
    fetchMock.mockResolvedValue(chatReply({ a: 0.9, b: 0.1 }));
    expect(await xor({ state: "s", questions: QUESTIONS, purpose: "p", images: [PNG] })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
