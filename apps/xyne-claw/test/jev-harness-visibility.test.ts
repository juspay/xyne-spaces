import { afterEach, describe, expect, it, vi } from "vitest";
import { jevAsk } from "../src/jev.js";
import { collectJudgeExchanges, pinRunJudgeBackend, setJudgeDebugSink } from "../src/judge-backend.js";

const ENV = ["LITELLM_URL", "LITELLM_API_KEY", "JUDGE_BACKEND"];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

function jevUp(answers: Record<string, unknown>) {
  process.env["LITELLM_URL"] = "https://grid.test";
  process.env["LITELLM_API_KEY"] = "k";
  process.env["JUDGE_BACKEND"] = "ournormaljev";
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ answers }), { status: 200 }));
}

const Q = { a: { type: "noul" as const, instructions: "is it a question?" } };
const inRun = <T>(fn: () => Promise<T>): Promise<T> =>
  new Promise((resolve, reject) => setImmediate(() => fn().then(resolve, reject)));

describe("every Jev call leaves its full exchange", () => {
  it("in the run trace: judge_call carries input, questions and answers", async () => {
    jevUp({ a: { type: "noul", noul: 0.8 } });
    const events: Array<{ kind: string; data: Record<string, unknown> }> = [];
    await inRun(async () => {
      pinRunJudgeBackend("ournormaljev");
      setJudgeDebugSink((kind, data) => events.push({ kind, data }));
      await jevAsk("STATE: user asked who owns X", Q, { purpose: "unit" });
    });
    const call = events.find((e) => e.kind === "judge_call")!;
    expect(call.data).toMatchObject({ purpose: "unit", backend: "ournormaljev", ok: true, questions: 1 });
    expect(call.data["state"]).toBe("STATE: user asked who owns X");
    expect(JSON.parse(String(call.data["questionSpec"]))).toEqual(Q);
    expect(JSON.parse(String(call.data["answers"]))).toEqual({ a: { type: "noul", noul: 0.8 } });
  });

  it("failures are recorded too, with the reason", async () => {
    process.env["LITELLM_URL"] = "https://grid.test";
    process.env["LITELLM_API_KEY"] = "k";
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    const events: Array<{ kind: string; data: Record<string, unknown> }> = [];
    await inRun(async () => {
      pinRunJudgeBackend("ournormaljev");
      setJudgeDebugSink((kind, data) => events.push({ kind, data }));
      expect(await jevAsk("s", Q, { purpose: "unit" })).toBeNull();
    });
    const call = events.find((e) => e.kind === "judge_call")!;
    expect(call.data).toMatchObject({ ok: false, answers: null });
    expect(String(call.data["error"])).toContain("500");
  });

  it("calls made before the trace exists (pre-run sites) are buffered, then flushed", async () => {
    jevUp({ a: { type: "noul", noul: 0.2 } });
    const events: string[] = [];
    await inRun(async () => {
      pinRunJudgeBackend("ournormaljev");
      await jevAsk("pre-run state", Q, { purpose: "mode-router" });
      setJudgeDebugSink((kind, data) => events.push(`${kind}:${String(data["purpose"])}:${String(data["state"])}`));
    });
    expect(events).toEqual(["judge_call:mode-router:pre-run state"]);
  });

  it("sites outside a run can collect their exchanges", async () => {
    jevUp({ a: { type: "noul", noul: 0.6 } });
    const { exchanges } = await collectJudgeExchanges(() => jevAsk("gate state", Q, { purpose: "twin-respond-gate" }));
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]).toMatchObject({ purpose: "twin-respond-gate", state: "gate state", ok: true });
  });
});
