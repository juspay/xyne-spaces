import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jevAsk, jevEnabled, judgeBackendConfigured, type JevQuestion } from "../src/jev.js";
import { judgeRunSummary, pinRunJudgeBackend, recordJudgeOutcome, setJudgeDebugSink } from "../src/judge-backend.js";
import { parseLlmJudgeReply } from "../src/judge-llm.js";

const QUESTIONS: Record<string, JevQuestion> = {
  a: { type: "noul", instructions: "is it done?" },
  b: { type: "noul", instructions: "is it partial?" },
};

const ENV_KEYS = [
  "JEV_API_KEY", "JEV_URL", "JEV_MODEL", "OUR_JEV_URL", "OUR_JEV_API_KEY",
  "OUR_NORMAL_JEV_URL", "OUR_NORMAL_JEV_API_KEY", "OUR_NORMAL_JEV_MODEL", "OUR_TRAINED_JEV_URL", "OUR_TRAINED_JEV_API_KEY", "OUR_TRAINED_JEV_MODEL",
  "JUDGE_LLM_URL", "JUDGE_LLM_API_KEY", "JUDGE_LLM_MODEL", "JUDGE_BACKEND", "JUDGE_SHADOW",
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

describe("judge backends", () => {
  const saved: Record<string, string | undefined> = {};
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.unstubAllGlobals();
  });

  it("routes each run to the backend it was pinned to", async () => {
    process.env["JEV_API_KEY"] = "k-jev";
    process.env["OUR_JEV_URL"] = "https://ourjev.internal/v1/systemone";
    process.env["OUR_JEV_API_KEY"] = "k-ours";
    process.env["OUR_NORMAL_JEV_MODEL"] = "our-jev-base";
    process.env["OUR_TRAINED_JEV_MODEL"] = "our-jev-ft-v3";
    process.env["JUDGE_LLM_URL"] = "https://llm.internal/v1/chat/completions";
    process.env["JUDGE_LLM_API_KEY"] = "k-llm";
    process.env["JUDGE_LLM_MODEL"] = "judge-model";
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("chat/completions") ? chatReply({ a: 0.9, b: 0.1 }) : systemOneReply({ a: 0.8, b: 0.2 }),
    );

    const seen: Record<string, string> = {};
    await Promise.all(
      (["jev", "ournormaljev", "ourtrainedjev", "llm"] as const).map(
        (backend) =>
          new Promise<void>((resolve) => {
            setImmediate(async () => {
              pinRunJudgeBackend(backend);
              await jevAsk("state", QUESTIONS, { purpose: "t" });
              seen[backend] = judgeRunSummary()?.backend ?? "none";
              resolve();
            });
          }),
      ),
    );

    expect(seen).toEqual({ jev: "jev", ournormaljev: "ournormaljev", ourtrainedjev: "ourtrainedjev", llm: "llm" });
    const urls = fetchMock.mock.calls.map((c) => String(c[0])).sort();
    expect(urls).toEqual([
      "https://api.typesafe.ai/v1/systemone",
      "https://llm.internal/v1/chat/completions",
      "https://ourjev.internal/v1/systemone",
      "https://ourjev.internal/v1/systemone",
    ]);
    const ours = fetchMock.mock.calls.filter((c) => String(c[0]).includes("ourjev"));
    const sentModels = ours.map((c) => (JSON.parse(String((c[1] as RequestInit).body)) as { model?: string }).model).sort();
    expect(sentModels).toEqual(["our-jev-base", "our-jev-ft-v3"]);
    for (const call of ours) {
      expect((call[1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer k-ours" });
    }
  });

  it("treats an unconfigured backend as unavailable so callers keep their old path", async () => {
    process.env["JEV_API_KEY"] = "k-jev";
    pinRunJudgeBackend("ourtrainedjev");
    expect(judgeBackendConfigured("ourtrainedjev")).toBe(false);
    expect(jevEnabled()).toBe(false);
    expect(await jevAsk("state", QUESTIONS)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hides a variant that would be indistinguishable from its sibling", () => {
    process.env["OUR_JEV_URL"] = "https://ourjev.internal/v1/systemone";
    process.env["OUR_JEV_API_KEY"] = "k-ours";
    expect(judgeBackendConfigured("ournormaljev")).toBe(false);
    expect(judgeBackendConfigured("ourtrainedjev")).toBe(false);

    process.env["OUR_TRAINED_JEV_MODEL"] = "our-jev-ft-v3";
    expect(judgeBackendConfigured("ourtrainedjev")).toBe(true);
    expect(judgeBackendConfigured("ournormaljev")).toBe(false);

    process.env["OUR_NORMAL_JEV_URL"] = "https://ourjev-base.internal/v1/systemone";
    expect(judgeBackendConfigured("ournormaljev")).toBe(true);
  });

  it("lets a variant override the shared endpoint and key", async () => {
    process.env["OUR_JEV_URL"] = "https://ourjev.internal/v1/systemone";
    process.env["OUR_JEV_API_KEY"] = "k-ours";
    process.env["OUR_TRAINED_JEV_URL"] = "https://trained.internal/v1/systemone";
    process.env["OUR_TRAINED_JEV_API_KEY"] = "k-trained";
    pinRunJudgeBackend("ourtrainedjev");
    fetchMock.mockResolvedValueOnce(systemOneReply({ a: 1, b: 0 }));
    await jevAsk("state", QUESTIONS);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("https://trained.internal/v1/systemone");
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer k-trained" });
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).not.toHaveProperty("model");
  });

  it("records per-run call stats including failures", async () => {
    process.env["JEV_API_KEY"] = "k-jev";
    pinRunJudgeBackend("jev");
    fetchMock.mockResolvedValueOnce(systemOneReply({ a: 1, b: 0 }));
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    await jevAsk("state", QUESTIONS, { purpose: "sift" });
    await jevAsk("state", QUESTIONS, { purpose: "sift" });
    const summary = judgeRunSummary();
    expect(summary).toMatchObject({ backend: "jev", calls: 2, failed: 1, questions: 4 });
    expect(summary?.byPurpose["sift"]).toMatchObject({ calls: 2, failed: 1 });
  });

  it("shadows the same questions on other backends and scores agreement", async () => {
    process.env["JEV_API_KEY"] = "k-jev";
    process.env["JUDGE_LLM_URL"] = "https://llm.internal/v1/chat/completions";
    process.env["JUDGE_LLM_API_KEY"] = "k-llm";
    process.env["JUDGE_LLM_MODEL"] = "judge-model";
    process.env["JUDGE_SHADOW"] = "llm,jev";
    pinRunJudgeBackend("jev");
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("chat/completions") ? chatReply({ a: 0.7, b: 0.9 }) : systemOneReply({ a: 0.9, b: 0.1 }),
    );

    const answers = await jevAsk("state", QUESTIONS, { purpose: "sift" });
    expect(answers?.["a"]?.noul).toBe(0.9);
    await vi.waitFor(() => expect(judgeRunSummary()?.shadows.length).toBe(1));

    const shadow = judgeRunSummary()?.shadows[0];
    expect(shadow).toMatchObject({ primary: "jev", shadow: "llm", questions: 2, agreed: 1 });
    expect(shadow?.meanAbsDiff).toBeCloseTo(0.5, 5);
  });
});

describe("judge debug events", () => {
  const saved: Record<string, string | undefined> = {};
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env["JEV_API_KEY"] = "k-jev";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.unstubAllGlobals();
  });

  it("sends every call and outcome to the run's debug sink", async () => {
    pinRunJudgeBackend("jev");
    const events: Array<{ kind: string; data: Record<string, unknown> }> = [];
    setJudgeDebugSink((kind, data) => events.push({ kind, data }));
    fetchMock.mockResolvedValueOnce(systemOneReply({ a: 1, b: 0 }));
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));

    await jevAsk("state", QUESTIONS, { purpose: "tool-search" });
    await jevAsk("state", QUESTIONS, { purpose: "tool-search" });
    recordJudgeOutcome("tool-search", "added 1", { added: [{ name: "spaces-desk-metrics", score: 0.9 }] });

    expect(events.map((e) => e.kind)).toEqual(["judge_call", "judge_call", "judge_outcome"]);
    expect(events[0]?.data).toMatchObject({ backend: "jev", purpose: "tool-search", questions: 2, ok: true });
    expect(events[1]?.data).toMatchObject({ ok: false });
    expect(events[2]?.data).toMatchObject({ backend: "jev", purpose: "tool-search", summary: "added 1" });
    expect(JSON.parse(String(events[2]?.data["detail"]))).toEqual({ added: [{ name: "spaces-desk-metrics", score: 0.9 }] });
  });

  it("never lets a throwing sink break the judge call", async () => {
    pinRunJudgeBackend("jev");
    setJudgeDebugSink(() => {
      throw new Error("recorder is gone");
    });
    fetchMock.mockResolvedValueOnce(systemOneReply({ a: 1, b: 0 }));
    const answers = await jevAsk("state", QUESTIONS, { purpose: "tool-search" });
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
    const questions: Record<string, JevQuestion> = {
      v: { type: "choice", instructions: "which?", criteria: { yes: "done", no: "not done" } },
    };
    expect(parseLlmJudgeReply('{"answers":{"v":{"choice":"maybe"}}}', questions)).toEqual({});
    expect(parseLlmJudgeReply('{"answers":{"v":"yes"}}', questions)).toEqual({ v: { type: "choice", choice: "yes" } });
  });

  it("throws on a reply with no JSON so the caller falls back", () => {
    expect(() => parseLlmJudgeReply("I cannot answer that", QUESTIONS)).toThrow();
  });
});
